package bisqstats

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

// ClosedTradesFile is the Bisq database file that stores closed trades.
const ClosedTradesFile = "ClosedTrades"

// Reader decodes Bisq's local ClosedTrades persistence file into internal trade
// records.
type Reader struct {
	dbDir string
}

// NewReader creates a Bisq stats reader rooted at dbDir.
func NewReader(dbDir string) *Reader {
	return &Reader{dbDir: dbDir}
}

// DefaultDBDir returns the default Bisq database directory below appDataDir.
func DefaultDBDir(appDataDir string) string {
	if appDataDir == "" {
		appDataDir = "/home/appuser/.local/share/Bisq"
	}
	return filepath.Join(appDataDir, "btc_mainnet", "db")
}

// ClosedTradesPath returns the full path to the Bisq ClosedTrades file.
func (r *Reader) ClosedTradesPath() string {
	return filepath.Join(r.dbDir, ClosedTradesFile)
}

// ReadClosedTradeRecords reads closed Bisq trades and reports skipped record counts by reason.
func (r *Reader) ReadClosedTradeRecords() ([]TradeRecord, map[string]int, error) {
	payload, err := os.ReadFile(r.ClosedTradesPath())
	if err != nil {
		return nil, nil, fmt.Errorf("read closed trades: %w", err)
	}

	envelope := newMessage("PersistableEnvelope")
	if err := proto.Unmarshal(payload, envelope); err != nil {
		// Bisq prefixes some persisted files with a single format/version byte.
		// Retrying from byte 1 keeps the parser resilient to that local encoding.
		if len(payload) > 1 {
			envelope = newMessage("PersistableEnvelope")
			if retryErr := proto.Unmarshal(payload[1:], envelope); retryErr == nil {
				goto decoded
			}
		}
		return nil, nil, fmt.Errorf("decode closed trades protobuf: %w", err)
	}

decoded:
	tradableListField := envelope.Descriptor().Fields().ByName("tradable_list")
	if tradableListField == nil || !envelope.Has(tradableListField) {
		return []TradeRecord{}, map[string]int{}, nil
	}

	tradableList := envelope.Get(tradableListField).Message()
	tradablesField := tradableList.Descriptor().Fields().ByName("tradable")
	if tradablesField == nil {
		return []TradeRecord{}, map[string]int{}, nil
	}

	list := tradableList.Get(tradablesField).List()
	records := make([]TradeRecord, 0, list.Len())
	skipped := map[string]int{}

	for i := 0; i < list.Len(); i++ {
		record, reason, ok := parseTradable(list.Get(i).Message())
		if !ok {
			skipped[reason]++
			continue
		}
		records = append(records, record)
	}

	return records, skipped, nil
}

func parseTradable(msg protoreflect.Message) (TradeRecord, string, bool) {
	switch {
	case hasField(msg, "buyer_as_maker_trade"):
		return parseTradeWrapper(msg.Get(msg.Descriptor().Fields().ByName("buyer_as_maker_trade")).Message(), "buyer_as_maker")
	case hasField(msg, "buyer_as_taker_trade"):
		return parseTradeWrapper(msg.Get(msg.Descriptor().Fields().ByName("buyer_as_taker_trade")).Message(), "buyer_as_taker")
	case hasField(msg, "seller_as_maker_trade"):
		return parseTradeWrapper(msg.Get(msg.Descriptor().Fields().ByName("seller_as_maker_trade")).Message(), "seller_as_maker")
	case hasField(msg, "seller_as_taker_trade"):
		return parseTradeWrapper(msg.Get(msg.Descriptor().Fields().ByName("seller_as_taker_trade")).Message(), "seller_as_taker")
	case hasField(msg, "bsq_swap_buyer_as_maker_trade"),
		hasField(msg, "bsq_swap_buyer_as_taker_trade"),
		hasField(msg, "bsq_swap_seller_as_maker_trade"),
		hasField(msg, "bsq_swap_seller_as_taker_trade"):
		return TradeRecord{}, "bsq_swap_trade", false
	default:
		return TradeRecord{}, "unknown_tradable_type", false
	}
}

func parseTradeWrapper(wrapper protoreflect.Message, role string) (TradeRecord, string, bool) {
	tradeField := wrapper.Descriptor().Fields().ByName("trade")
	if tradeField == nil || !wrapper.Has(tradeField) {
		return TradeRecord{}, "missing_trade_payload", false
	}

	trade := wrapper.Get(tradeField).Message()
	takeOfferAt := unixMillisField(trade, "take_offer_date")
	if takeOfferAt.IsZero() {
		return TradeRecord{}, "missing_take_offer_date", false
	}

	sellerConfirmedAt := unixMillisField(trade, "sellerConfirmedPaymentReceiptDate")
	if sellerConfirmedAt.IsZero() {
		return TradeRecord{}, "missing_seller_confirmed_payment_receipt_date", false
	}
	if sellerConfirmedAt.Before(takeOfferAt) {
		return TradeRecord{}, "negative_duration", false
	}

	paymentMethodID, fiatCurrency := tradeMarketInfo(trade)
	if fiatCurrency == "" || strings.EqualFold(fiatCurrency, "BTC") || strings.EqualFold(fiatCurrency, "BSQ") {
		return TradeRecord{}, "non_fiat_trade", false
	}

	return TradeRecord{
		TradeID:            stringField(trade, "uid", stringField(trade, "taker_fee_tx_id", "")),
		Role:               role,
		PaymentMethodID:    paymentMethodID,
		FiatCurrency:       strings.ToUpper(fiatCurrency),
		TakeOfferAt:        takeOfferAt,
		SellerConfirmedAt:  sellerConfirmedAt,
		SettlementDuration: sellerConfirmedAt.Sub(takeOfferAt),
	}, "", true
}

func tradeMarketInfo(trade protoreflect.Message) (paymentMethodID string, fiatCurrency string) {
	if contractField := trade.Descriptor().Fields().ByName("contract"); contractField != nil && trade.Has(contractField) {
		contract := trade.Get(contractField).Message()
		paymentMethodID = stringField(contract, "taker_payment_method_id", "")
		if paymentMethodID == "" {
			paymentMethodID = stringField(contract, "maker_payment_method_id", "")
		}
		if offerPayloadField := contract.Descriptor().Fields().ByName("offer_payload"); offerPayloadField != nil && contract.Has(offerPayloadField) {
			offerPayload := contract.Get(offerPayloadField).Message()
			if paymentMethodID == "" {
				paymentMethodID = stringField(offerPayload, "payment_method_id", "")
			}
			fiatCurrency = stringField(offerPayload, "counter_currency_code", "")
		}
	}

	if fiatCurrency == "" {
		if offerField := trade.Descriptor().Fields().ByName("offer"); offerField != nil && trade.Has(offerField) {
			offer := trade.Get(offerField).Message()
			if offerPayloadField := offer.Descriptor().Fields().ByName("offer_payload"); offerPayloadField != nil && offer.Has(offerPayloadField) {
				offerPayload := offer.Get(offerPayloadField).Message()
				if paymentMethodID == "" {
					paymentMethodID = stringField(offerPayload, "payment_method_id", "")
				}
				fiatCurrency = stringField(offerPayload, "counter_currency_code", "")
			}
		}
	}

	return strings.TrimSpace(paymentMethodID), strings.TrimSpace(fiatCurrency)
}

func hasField(msg protoreflect.Message, fieldName string) bool {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	return field != nil && msg.Has(field)
}

func stringField(msg protoreflect.Message, fieldName string, fallback string) string {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !msg.Has(field) {
		return fallback
	}
	return msg.Get(field).String()
}

func unixMillisField(msg protoreflect.Message, fieldName string) time.Time {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !msg.Has(field) {
		return time.Time{}
	}
	ms := msg.Get(field).Int()
	if ms <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

var (
	fileDesc     protoreflect.FileDescriptor
	fileDescOnce sync.Once
	fileDescErr  error
)

func descriptor() protoreflect.FileDescriptor {
	fileDescOnce.Do(func() {
		fileDesc, fileDescErr = protodesc.NewFile(buildFileDescriptor(), nil)
	})
	if fileDescErr != nil {
		panic(fileDescErr)
	}
	return fileDesc
}

func newMessage(name string) *dynamicpb.Message {
	md := descriptor().Messages().ByName(protoreflect.Name(name))
	if md == nil {
		panic("missing protobuf message descriptor: " + name)
	}
	return dynamicpb.NewMessage(md)
}

func buildFileDescriptor() *descriptorpb.FileDescriptorProto {
	// This is a minimal dynamic descriptor, not a full Bisq schema clone. It
	// only defines the nested messages/fields needed to read ClosedTrades.
	return &descriptorpb.FileDescriptorProto{
		Syntax:  strptr("proto3"),
		Name:    strptr("bisq_trade_stats.proto"),
		Package: strptr("io.bisq.protobuffer"),
		MessageType: []*descriptorpb.DescriptorProto{
			message("PersistableEnvelope", []*descriptorpb.FieldDescriptorProto{
				messageField("tradable_list", 6, ".io.bisq.protobuffer.TradableList", true),
			}, oneof("message")),
			message("TradableList", []*descriptorpb.FieldDescriptorProto{
				repeatedMessageField("tradable", 1, ".io.bisq.protobuffer.Tradable"),
			}),
			message("Tradable", []*descriptorpb.FieldDescriptorProto{
				messageField("buyer_as_maker_trade", 2, ".io.bisq.protobuffer.BuyerAsMakerTrade", true),
				messageField("buyer_as_taker_trade", 3, ".io.bisq.protobuffer.BuyerAsTakerTrade", true),
				messageField("seller_as_maker_trade", 4, ".io.bisq.protobuffer.SellerAsMakerTrade", true),
				messageField("seller_as_taker_trade", 5, ".io.bisq.protobuffer.SellerAsTakerTrade", true),
				messageField("bsq_swap_buyer_as_maker_trade", 6, ".io.bisq.protobuffer.BsqSwapBuyerAsMakerTrade", true),
				messageField("bsq_swap_buyer_as_taker_trade", 7, ".io.bisq.protobuffer.BsqSwapBuyerAsTakerTrade", true),
				messageField("bsq_swap_seller_as_maker_trade", 8, ".io.bisq.protobuffer.BsqSwapSellerAsMakerTrade", true),
				messageField("bsq_swap_seller_as_taker_trade", 9, ".io.bisq.protobuffer.BsqSwapSellerAsTakerTrade", true),
			}, oneof("message")),
			message("BuyerAsMakerTrade", []*descriptorpb.FieldDescriptorProto{
				messageField("trade", 1, ".io.bisq.protobuffer.Trade", false),
			}),
			message("BuyerAsTakerTrade", []*descriptorpb.FieldDescriptorProto{
				messageField("trade", 1, ".io.bisq.protobuffer.Trade", false),
			}),
			message("SellerAsMakerTrade", []*descriptorpb.FieldDescriptorProto{
				messageField("trade", 1, ".io.bisq.protobuffer.Trade", false),
			}),
			message("SellerAsTakerTrade", []*descriptorpb.FieldDescriptorProto{
				messageField("trade", 1, ".io.bisq.protobuffer.Trade", false),
			}),
			message("BsqSwapBuyerAsMakerTrade", nil),
			message("BsqSwapBuyerAsTakerTrade", nil),
			message("BsqSwapSellerAsMakerTrade", nil),
			message("BsqSwapSellerAsTakerTrade", nil),
			message("Trade", []*descriptorpb.FieldDescriptorProto{
				messageField("offer", 1, ".io.bisq.protobuffer.Offer", false),
				field("taker_fee_tx_id", 3, descriptorpb.FieldDescriptorProto_TYPE_STRING),
				field("take_offer_date", 9, descriptorpb.FieldDescriptorProto_TYPE_INT64),
				messageField("contract", 16, ".io.bisq.protobuffer.Contract", false),
				field("uid", 39, descriptorpb.FieldDescriptorProto_TYPE_STRING),
				field("sellerConfirmedPaymentReceiptDate", 40, descriptorpb.FieldDescriptorProto_TYPE_INT64),
			}),
			message("Offer", []*descriptorpb.FieldDescriptorProto{
				messageField("offer_payload", 1, ".io.bisq.protobuffer.OfferPayload", true),
				messageField("bsq_swap_offer_payload", 2, ".io.bisq.protobuffer.BsqSwapOfferPayload", true),
			}, oneof("message")),
			message("Contract", []*descriptorpb.FieldDescriptorProto{
				messageField("offer_payload", 1, ".io.bisq.protobuffer.OfferPayload", false),
				field("maker_payment_method_id", 24, descriptorpb.FieldDescriptorProto_TYPE_STRING),
				field("taker_payment_method_id", 25, descriptorpb.FieldDescriptorProto_TYPE_STRING),
			}),
			message("OfferPayload", []*descriptorpb.FieldDescriptorProto{
				field("counter_currency_code", 12, descriptorpb.FieldDescriptorProto_TYPE_STRING),
				field("payment_method_id", 15, descriptorpb.FieldDescriptorProto_TYPE_STRING),
			}),
			message("BsqSwapOfferPayload", nil),
		},
	}
}

func message(name string, fields []*descriptorpb.FieldDescriptorProto, oneofs ...*descriptorpb.OneofDescriptorProto) *descriptorpb.DescriptorProto {
	return &descriptorpb.DescriptorProto{
		Name:      strptr(name),
		Field:     fields,
		OneofDecl: oneofs,
	}
}

func oneof(name string) *descriptorpb.OneofDescriptorProto {
	return &descriptorpb.OneofDescriptorProto{Name: strptr(name)}
}

func field(name string, number int32, kind descriptorpb.FieldDescriptorProto_Type) *descriptorpb.FieldDescriptorProto {
	return &descriptorpb.FieldDescriptorProto{
		Name:   strptr(name),
		Number: int32ptr(number),
		Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
		Type:   kind.Enum(),
	}
}

func messageField(name string, number int32, typeName string, inOneof bool) *descriptorpb.FieldDescriptorProto {
	field := &descriptorpb.FieldDescriptorProto{
		Name:     strptr(name),
		Number:   int32ptr(number),
		Label:    descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
		Type:     descriptorpb.FieldDescriptorProto_TYPE_MESSAGE.Enum(),
		TypeName: strptr(typeName),
	}
	if inOneof {
		field.OneofIndex = int32ptr(0)
	}
	return field
}

func repeatedMessageField(name string, number int32, typeName string) *descriptorpb.FieldDescriptorProto {
	return &descriptorpb.FieldDescriptorProto{
		Name:     strptr(name),
		Number:   int32ptr(number),
		Label:    descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(),
		Type:     descriptorpb.FieldDescriptorProto_TYPE_MESSAGE.Enum(),
		TypeName: strptr(typeName),
	}
}

func strptr(v string) *string { return &v }

func int32ptr(v int32) *int32 { return &v }

// DebugJSON returns a JSON representation useful while inspecting decoded Bisq records.
func DebugJSON(data []byte) string {
	msg := newMessage("PersistableEnvelope")
	if err := proto.Unmarshal(data, msg); err != nil {
		return err.Error()
	}
	b, err := protojson.MarshalOptions{Multiline: true}.Marshal(msg)
	if err != nil {
		return err.Error()
	}
	return string(b)
}
