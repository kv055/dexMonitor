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

// TestBuildGroupsCanonicalizesAndSplits feeds the messy compound + variant
// strings seen in production and asserts they collapse into clean, categorized,
// de-duplicated atoms.
func TestBuildGroupsCanonicalizesAndSplits(t *testing.T) {
	methods := []string{
		// PayPal case variants (the "listed 3 times" bug)
		"PayPal", "Paypal", "paypal",
		// Paysafe variants (the original example)
		"paysafecard", "paysafe card", "Paysafe",
		// Free-text compounds in different orders
		"Instant SEPA Revolut Strike MBWay",
		"Revolut Strike Instant SEPA MBWay",
		"Instant SEPA Bizum Amazon ES GiftCard",
		"SEPA_INSTANT",
		// A legit single bank that must survive untouched
		"Deutsche Bank",
	}
	groups := buildGroups(methods)

	bank := methodsOf(findGroup(groups, "bank_transfer"))
	if !bank["SEPA Instant"] {
		t.Errorf("bank_transfer missing 'SEPA Instant': %v", bank)
	}
	// "Instant SEPA" and "SEPA_INSTANT" must collapse to one entry.
	if bank["Instant SEPA"] || bank["SEPA_INSTANT"] {
		t.Errorf("bank_transfer still has un-normalized SEPA variants: %v", bank)
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

	// The legit bank name passes through verbatim into "other".
	other := methodsOf(findGroup(groups, "other"))
	if !other["Deutsche Bank"] {
		t.Errorf("'Deutsche Bank' should survive verbatim in other: %v", other)
	}
}

// TestBuildGroupsNoDuplicates verifies a method appears at most once across the
// whole grouped result.
func TestBuildGroupsNoDuplicates(t *testing.T) {
	methods := []string{
		"Revolut Instant SEPA",
		"Instant SEPA Revolut",
		"Revolut",
		"REVOLUT",
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
}
