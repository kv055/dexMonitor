package paymentmethods

import (
	"reflect"
	"testing"
)

func TestNormalizeMethod(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		// Paysafe variants — the original motivating example
		{"paysafecard", "Paysafecard"},
		{"paysafe card", "Paysafecard"},
		{"Paysafe Card", "Paysafecard"},
		{"PAYSAFE-CARD", "Paysafecard"},
		{"paysafe_card", "Paysafecard"},
		{"paysafe", "Paysafecard"},
		{"Paysafe", "Paysafecard"},

		// Cash App
		{"cashapp", "Cash App"},
		{"CashApp", "Cash App"},
		{"cash app", "Cash App"},
		{"Cash App", "Cash App"},
		{"cash_app", "Cash App"},

		// PayPal
		{"paypal", "PayPal"},
		{"PayPal", "PayPal"},
		{"pay pal", "PayPal"},

		// Wise / TransferWise
		{"wise", "Wise"},
		{"Wise", "Wise"},
		{"transferwise", "Wise"},
		{"TransferWise", "Wise"},
		{"transfer wise", "Wise"},
		{"Transfer-Wise", "Wise"},

		// MB Way
		{"mbway", "MB Way"},
		{"mb way", "MB Way"},
		{"MB Way", "MB Way"},
		{"mb_way", "MB Way"},

		// Apple Pay / Google Pay
		{"apple pay", "Apple Pay"},
		{"applepay", "Apple Pay"},
		{"google pay", "Google Pay"},
		{"googlepay", "Google Pay"},

		// PromptPay / GCash
		{"promptpay", "PromptPay"},
		{"prompt pay", "PromptPay"},
		{"gcash", "GCash"},
		{"g cash", "GCash"},

		// SEPA variants
		{"SEPA", "SEPA"},
		{"sepa", "SEPA"},
		{"sepa instant", "SEPA Instant"},
		{"SEPA Instant", "SEPA Instant"},
		{"instant sepa", "SEPA Instant"},
		{"Instant SEPA", "SEPA Instant"},

		// National Bank / Transfer
		{"national_bank", "National Bank"},
		{"national bank", "National Bank"},
		{"National Bank", "National Bank"},
		{"national_transfer", "National Transfer"},
		{"national transfer", "National Transfer"},

		// Bank Transfer
		{"bank transfer", "Bank Transfer"},
		{"bank_transfer", "Bank Transfer"},
		{"Bank Transfer", "Bank Transfer"},

		// Faster Payments (singular and plural)
		{"faster payment", "Faster Payments"},
		{"faster payments", "Faster Payments"},
		{"Faster Payment", "Faster Payments"},

		// Gift Card
		{"gift card", "Gift Card"},
		{"giftcard", "Gift Card"},
		{"gift-card", "Gift Card"},
		{"gift cards", "Gift Card"},

		// Google Play Card
		{"google play card", "Google Play Card"},
		{"google_play_card", "Google Play Card"},

		// Face to Face / F2F
		{"face to face", "Face to Face"},
		{"face-to-face", "Face to Face"},
		{"f2f", "Face to Face"},
		{"F2F", "Face to Face"},

		// In Person
		{"in person", "In Person"},
		{"in-person", "In Person"},

		// On-Chain
		{"onchain", "On-Chain"},
		{"on-chain", "On-Chain"},
		{"on chain", "On-Chain"},

		// Passthrough — no matching rule
		{"Revolut", "Revolut"},
		{"Zelle", "Zelle"},
		{"Lightning", "Lightning"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizeMethod(tt.input)
			if got != tt.want {
				t.Errorf("normalizeMethod(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestDeduplicateMethods(t *testing.T) {
	input := []string{
		"paysafecard",
		"paysafe card",
		"Paysafe",
		"PAYSAFE-CARD",
	}
	got := deduplicateMethods(input)
	if len(got) != 1 {
		t.Fatalf("expected 1 method, got %d: %v", len(got), got)
	}
	if got[0] != "Paysafecard" {
		t.Errorf("expected %q, got %q", "Paysafecard", got[0])
	}
}

func TestBuildGroupsDeduplicates(t *testing.T) {
	methods := []string{
		"paysafecard",
		"paysafe card",
		"cash app",
		"CashApp",
		"cashapp",
		"SEPA",
		"sepa",
		"national_bank",
		"national bank",
		"Revolut",
		"onchain",
		"on-chain",
	}
	groups := buildGroups(methods)

	find := func(name string) *Group {
		for i := range groups {
			if groups[i].Name == name {
				return &groups[i]
			}
		}
		return nil
	}

	if g := find("gift_cards"); g != nil {
		if len(g.Methods) != 1 {
			t.Errorf("gift_cards: expected 1 method, got %d: %v", len(g.Methods), g.Methods)
		}
	} else {
		t.Error("missing gift_cards group")
	}

	if g := find("bank_transfer"); g != nil {
		has := make(map[string]bool)
		for _, m := range g.Methods {
			has[m] = true
		}
		if has["national_bank"] {
			t.Error("bank_transfer should not contain raw 'national_bank', expected normalized 'National Bank'")
		}
		if !has["National Bank"] {
			t.Error("bank_transfer should contain 'National Bank'")
		}
		if !has["SEPA"] {
			t.Error("bank_transfer should contain 'SEPA'")
		}
	} else {
		t.Error("missing bank_transfer group")
	}

	if g := find("crypto"); g != nil {
		if len(g.Methods) != 1 {
			t.Errorf("crypto: expected 1 method after dedup, got %d: %v", len(g.Methods), g.Methods)
		}
	}
}

func TestSplitCompoundMethod(t *testing.T) {
	tests := []struct {
		input string
		want  []string
	}{
		// Single methods pass through unchanged
		{"Revolut", []string{"Revolut"}},
		{"SEPA", []string{"SEPA"}},
		{"MBWay", []string{"MBWay"}},

		// Known multi-word methods stay intact
		{"Instant SEPA", []string{"Instant SEPA"}},
		{"Cash App", []string{"Cash App"}},
		{"Faster Payment", []string{"Faster Payment"}},

		// Compound strings from Bisq2 get split
		{"Instant SEPA Bizum", []string{"Instant SEPA", "Bizum"}},
		{"Instant SEPA Revolut Strike MBWay", []string{"Instant SEPA", "Revolut", "Strike", "MBWay"}},
		{"Instant SEPA Wise N26 Paysera Vivid", []string{"Instant SEPA", "Wise", "N26", "Paysera", "Vivid"}},
		{"Instant SEPA Paypal Friends & Family", []string{"Instant SEPA", "Paypal Friends & Family"}},
		{"Instant SEPA Bizum Amazon ES GiftCard", []string{"Instant SEPA", "Bizum", "Amazon ES GiftCard"}},
		{"Instant SEPA Revolut Paypal Friends & Family", []string{"Instant SEPA", "Revolut", "Paypal Friends & Family"}},
		{"Instant SEPA Wise Revolut N26 Paysera", []string{"Instant SEPA", "Wise", "Revolut", "N26", "Paysera"}},

		// Edge cases
		{"", nil},
		{"  Revolut  ", []string{"Revolut"}},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := splitCompoundMethod(tt.input)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("splitCompoundMethod(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestBuildGroupsSplitsCompounds(t *testing.T) {
	methods := []string{
		"Instant SEPA Revolut Strike MBWay",
		"Instant SEPA Bizum",
		"Instant SEPA Wise",
		"Revolut",
	}
	groups := buildGroups(methods)

	find := func(name string) *Group {
		for i := range groups {
			if groups[i].Name == name {
				return &groups[i]
			}
		}
		return nil
	}

	// "Instant SEPA" should land in bank_transfer (once, deduplicated)
	if g := find("bank_transfer"); g != nil {
		if len(g.Methods) != 1 {
			t.Errorf("bank_transfer: expected 1 method (SEPA Instant), got %d: %v", len(g.Methods), g.Methods)
		}
	} else {
		t.Error("missing bank_transfer group")
	}

	// Revolut, Strike, Bizum, Wise, MBWay should all land in money_transmitter (deduplicated)
	if g := find("money_transmitter"); g != nil {
		has := make(map[string]bool)
		for _, m := range g.Methods {
			has[m] = true
		}
		for _, want := range []string{"Revolut", "Strike", "Wise"} {
			if !has[want] {
				t.Errorf("money_transmitter: missing %q, got %v", want, g.Methods)
			}
		}
	} else {
		t.Error("missing money_transmitter group")
	}
}
