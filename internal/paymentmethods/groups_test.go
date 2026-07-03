package paymentmethods

import (
	"testing"
)

func findGroup(groups []Group, name string) *Group {
	for i := range groups {
		if groups[i].Name == name {
			return &groups[i]
		}
	}
	return nil
}

func methodsOf(g *Group) map[string]bool {
	set := make(map[string]bool)
	if g == nil {
		return set
	}
	for _, m := range g.Methods {
		set[m] = true
	}
	return set
}

func TestBuildGroupsCanonicalizesAndSplits(t *testing.T) {
	methods := []string{
		"PayPal", "Paypal", "paypal",
		"paysafecard", "paysafe card", "Paysafe",
		"Instant SEPA Revolut Strike MBWay",
		"Revolut Strike Instant SEPA MBWay",
		"Instant SEPA Bizum Amazon ES GiftCard",
		"SEPA_INSTANT",
		"Deutsche Bank",
	}
	groups := buildGroups(methods)

	bank := methodsOf(findGroup(groups, "bank_transfer"))
	if !bank["SEPA Instant"] {
		t.Errorf("bank_transfer missing 'SEPA Instant': %v", bank)
	}
	if bank["Instant SEPA"] || bank["SEPA_INSTANT"] {
		t.Errorf("bank_transfer still has un-normalized SEPA variants: %v", bank)
	}
	if !bank["National Bank"] {
		t.Errorf("bank_transfer missing 'National Bank' (from Deutsche Bank): %v", bank)
	}
	if bank["Deutsche Bank"] {
		t.Errorf("bank_transfer should not list raw Deutsche Bank: %v", bank)
	}

	mt := methodsOf(findGroup(groups, "money_transmitter"))
	if !mt["PayPal"] {
		t.Errorf("money_transmitter missing 'PayPal': %v", mt)
	}
	for _, want := range []string{"Revolut", "Strike", "MB Way", "Bizum"} {
		if !mt[want] {
			t.Errorf("money_transmitter missing %q: %v", want, mt)
		}
	}

	gift := methodsOf(findGroup(groups, "gift_cards"))
	if !gift["Paysafecard"] {
		t.Errorf("gift_cards missing 'Paysafecard': %v", gift)
	}
	if !gift["Amazon Gift Card"] {
		t.Errorf("gift_cards missing 'Amazon Gift Card': %v", gift)
	}
}

func TestBuildGroupsNoDuplicates(t *testing.T) {
	methods := []string{
		"Revolut Instant SEPA",
		"Instant SEPA Revolut",
		"Revolut",
		"REVOLUT",
		"Deutsche Bank",
		"ING",
	}
	groups := buildGroups(methods)

	seen := make(map[string]int)
	for _, g := range groups {
		for _, m := range g.Methods {
			seen[m]++
		}
	}
	for m, n := range seen {
		if n > 1 {
			t.Errorf("method %q appears %d times across groups", m, n)
		}
	}
	if seen["Revolut"] != 1 {
		t.Errorf("expected exactly one 'Revolut', got %d", seen["Revolut"])
	}
	if seen["SEPA Instant"] != 1 {
		t.Errorf("expected exactly one 'SEPA Instant', got %d", seen["SEPA Instant"])
	}
	if seen["National Bank"] != 1 {
		t.Errorf("expected exactly one 'National Bank', got %d", seen["National Bank"])
	}
}

func TestBuildGroupsCryptoCategory(t *testing.T) {
	methods := []string{
		"Monero",
		"Other coins",
		"SOL XRP XLM",
		"USDT LTC",
		"Altcoins Instant",
		"on-chain",
		"Liquid",
		"TUSD",
		"True USD",
		"PYUSD",
	}
	groups := buildGroups(methods)
	crypto := methodsOf(findGroup(groups, "crypto"))
	for _, want := range []string{
		"Monero", "Other Coins", "Solana", "Stellar", "XRP", "Litecoin", "USDT", "Altcoins Instant", "Bitcoin",
		"Liquid Bitcoin", "True USD", "PYUSD",
	} {
		if !crypto[want] {
			t.Errorf("crypto group missing %q: %v", want, crypto)
		}
	}
	if other := methodsOf(findGroup(groups, "other")); len(other) > 0 {
		t.Errorf("expected no crypto methods in other, got %v", other)
	}
}
