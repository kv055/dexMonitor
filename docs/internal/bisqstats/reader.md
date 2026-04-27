# `internal/bisqstats/reader.go`

Source package: `bisqstats`  
Source lines: `358`

## Package Purpose

This file contributes to the `bisqstats` package.

## File Role

This file defines 1 type(s), implements 21 function or method entry point(s), declares 4 package value(s).

## Runtime Behavior

- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.

## Types

### `Reader`

Reader decodes Bisq's local ClosedTrades persistence file into internal trade
records.

Fields:

- `dbDir` `string`: Stores the db dir value for the reader.

## Functions and Methods

### `NewReader`

NewReader creates a Bisq stats reader rooted at dbDir.

Signature: `func NewReader(dbDir string) *Reader`

### `DefaultDBDir`

DefaultDBDir returns the default Bisq database directory below appDataDir.

Signature: `func DefaultDBDir(appDataDir string) string`

### `(*Reader).ClosedTradesPath`

ClosedTradesPath returns the full path to the Bisq ClosedTrades file.

Signature: `func (r *Reader) ClosedTradesPath() string`

### `(*Reader).ReadClosedTradeRecords`

ReadClosedTradeRecords reads closed Bisq trades and reports skipped record counts by reason.

Signature: `func (r *Reader) ReadClosedTradeRecords() ([]TradeRecord, map[string]int, error)`

### `parseTradable`

This function is part of the `bisqstats` package implementation.

Signature: `func parseTradable(msg protoreflect.Message) (TradeRecord, string, bool)`

### `parseTradeWrapper`

This function is part of the `bisqstats` package implementation.

Signature: `func parseTradeWrapper(wrapper protoreflect.Message, role string) (TradeRecord, string, bool)`

### `tradeMarketInfo`

This function is part of the `bisqstats` package implementation.

Signature: `func tradeMarketInfo(trade protoreflect.Message) (paymentMethodID string, fiatCurrency string)`

### `hasField`

This function is part of the `bisqstats` package implementation.

Signature: `func hasField(msg protoreflect.Message, fieldName string) bool`

### `stringField`

This function is part of the `bisqstats` package implementation.

Signature: `func stringField(msg protoreflect.Message, fieldName string, fallback string) string`

### `unixMillisField`

This function is part of the `bisqstats` package implementation.

Signature: `func unixMillisField(msg protoreflect.Message, fieldName string) time.Time`

### `descriptor`

This function is part of the `bisqstats` package implementation.

Signature: `func descriptor() protoreflect.FileDescriptor`

### `newMessage`

This function is part of the `bisqstats` package implementation.

Signature: `func newMessage(name string) *dynamicpb.Message`

### `buildFileDescriptor`

This function is part of the `bisqstats` package implementation.

Signature: `func buildFileDescriptor() *descriptorpb.FileDescriptorProto`

### `message`

This function is part of the `bisqstats` package implementation.

Signature: `func message(name string, fields []*descriptorpb.FieldDescriptorProto, oneofs ...*descriptorpb.OneofDescriptorProto) *descriptorpb.DescriptorProto`

### `oneof`

This function is part of the `bisqstats` package implementation.

Signature: `func oneof(name string) *descriptorpb.OneofDescriptorProto`

### `field`

This function is part of the `bisqstats` package implementation.

Signature: `func field(name string, number int32, kind descriptorpb.FieldDescriptorProto_Type) *descriptorpb.FieldDescriptorProto`

### `messageField`

This function is part of the `bisqstats` package implementation.

Signature: `func messageField(name string, number int32, typeName string, inOneof bool) *descriptorpb.FieldDescriptorProto`

### `repeatedMessageField`

This function is part of the `bisqstats` package implementation.

Signature: `func repeatedMessageField(name string, number int32, typeName string) *descriptorpb.FieldDescriptorProto`

### `strptr`

This function is part of the `bisqstats` package implementation.

Signature: `func strptr(v string) *string`

### `int32ptr`

This function is part of the `bisqstats` package implementation.

Signature: `func int32ptr(v int32) *int32`

### `DebugJSON`

DebugJSON returns a JSON representation useful while inspecting decoded Bisq records.

Signature: `func DebugJSON(data []byte) string`

## Constants and Variables

- `ClosedTradesFile`: ClosedTradesFile is the Bisq database file that stores closed trades.
- `fileDesc`: No inline declaration comment is present.
- `fileDescOnce`: No inline declaration comment is present.
- `fileDescErr`: No inline declaration comment is present.

## Key Dependencies

- `fmt`
- `os`
- `path/filepath`
- `strings`
- `sync`
- `time`
- `google.golang.org/protobuf/encoding/protojson`
- `google.golang.org/protobuf/proto`
- `google.golang.org/protobuf/reflect/protodesc`
- `google.golang.org/protobuf/reflect/protoreflect`
- `google.golang.org/protobuf/types/descriptorpb`
- `google.golang.org/protobuf/types/dynamicpb`

