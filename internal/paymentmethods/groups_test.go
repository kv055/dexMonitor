package paymentmethods

import (
	"testing"

	commonpm "commons/paymentmethods"
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
		"Paypal Friends & Family",
		"Instant SEPA Revolut N26",
		"Revolut N26 Instant SEPA",
		"Instant SEPA Wise",
		"SEPA_INSTANT",
		"Deutsche Bank",
		"Strike",
		"Totally Unknown Rail",
	}
	groups := buildGroups(commonpm.NewRegistry(commonpm.SeedRows()), methods)

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

	mt := methodsOf(findGroup(groups, "fiat_transmitter"))
	if !mt["PayPal"] {
		t.Errorf("fiat_transmitter missing 'PayPal': %v", mt)
	}
	for _, want := range []string{"Revolut", "Wise", "N26", "Strike"} {
		if !mt[want] {
			t.Errorf("fiat_transmitter missing %q: %v", want, mt)
		}
	}

	other := methodsOf(findGroup(groups, "others"))
	if !other["Totally Unknown Rail"] {
		t.Errorf("others missing unmatched rail: %v", other)
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
	groups := buildGroups(commonpm.NewRegistry(commonpm.SeedRows()), methods)

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
		"Lightning",
		"lnurl",
		"Monero",
		"Totally Unknown Coin",
	}
	groups := buildGroups(commonpm.NewRegistry(commonpm.SeedRows()), methods)
	crypto := methodsOf(findGroup(groups, "crypto"))
	if !crypto["Lightning"] {
		t.Errorf("crypto group missing Lightning: %v", crypto)
	}
	if !crypto["Monero"] {
		t.Errorf("crypto group missing Monero: %v", crypto)
	}
	other := methodsOf(findGroup(groups, "others"))
	if !other["Totally Unknown Coin"] {
		t.Errorf("others missing unmatched coin: %v", other)
	}
}
