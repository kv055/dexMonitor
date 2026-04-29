package paymentmethods

import "strings"

// Group represents a logical payment method category with all raw method strings
// that belong to it (as found in the offers table).
type Group struct {
	// Name is the name value for the group.
	Name string `json:"name"`
	// DisplayName is the display name value for the group.
	DisplayName string `json:"display_name"`
	// Methods is the methods value for the group.
	Methods []string `json:"methods"`
}

// groupRule maps a canonical group name to a list of case-insensitive substrings.
// The first matching rule wins — order matters.
type groupRule struct {
	name        string
	displayName string
	keywords    []string
}

var groupRules = []groupRule{
	{
		name:        "cash",
		displayName: "Cash",
		keywords:    []string{"cash", "f2f", "face to face", "face-to-face", "in person", "physical", "mail"},
	},
	{
		// Must come before bank_transfer — "sepa instant" must match here, not in bank_transfer.
		name:        "instant_bank_transfer",
		displayName: "Instant Bank Transfer",
		keywords:    []string{"sepa instant", "faster payment", "interac", "instant"},
	},
	{
		name:        "bank_transfer",
		displayName: "Bank Transfer",
		keywords:    []string{"sepa", "national_bank", "national bank", "swift", "wire", "bank transfer", "ach"},
	},
	{
		name:        "money_transmitter",
		displayName: "Money Transmitter",
		keywords:    []string{"revolut", "paypal", "wise", "transferwise", "venmo", "cash app", "cashapp", "skrill", "neteller", "payoneer", "strike", "zelle"},
	},
	{
		name:        "mobile_payment",
		displayName: "Mobile Payment",
		keywords:    []string{"mbway", "bizum", "twint", "satispay", "pix", "promptpay", "gcash", "blik", "vipps", "mobile"},
	},
	{
		name:        "crypto",
		displayName: "Crypto",
		keywords:    []string{"lightning", "monero", "usdt", "usdc", "crypto", "onchain", "on-chain"},
	},
}

// classifyMethod returns the group name for the given raw payment method string.
// Returns "other" if no rule matches.
func classifyMethod(method string) string {
	lower := strings.ToLower(method)
	for _, rule := range groupRules {
		for _, kw := range rule.keywords {
			if strings.Contains(lower, kw) {
				return rule.name
			}
		}
	}
	return "other"
}

// buildGroups takes a list of distinct payment method strings and returns
// them organized into Group slices. Groups with no methods are omitted.
// The "other" catch-all group is always last if non-empty.
func buildGroups(methods []string) []Group {
	// Preserve insertion order within each group.
	groupMethods := make(map[string][]string)
	for _, m := range methods {
		key := classifyMethod(m)
		groupMethods[key] = append(groupMethods[key], m)
	}

	// Build result in rule order, then "other".
	var groups []Group
	for _, rule := range groupRules {
		ms := groupMethods[rule.name]
		if len(ms) == 0 {
			continue
		}
		groups = append(groups, Group{
			Name:        rule.name,
			DisplayName: rule.displayName,
			Methods:     ms,
		})
	}
	if other := groupMethods["other"]; len(other) > 0 {
		groups = append(groups, Group{
			Name:        "other",
			DisplayName: "Other",
			Methods:     other,
		})
	}
	return groups
}
