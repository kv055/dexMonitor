package paymentmethods

import (
	"strings"

	commonpm "commons/paymentmethods"
)

// Group represents a logical payment method category with all canonical method
// names that belong to it.
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
		name:        "bank_transfer",
		displayName: "Bank Transfer",
		keywords:    []string{"sepa instant", "faster payment", "interac", "instant", "sepa", "national_bank", "national bank", "national transfer", "n26", "swift", "wire", "bank transfer", "ach"},
	},
	{
		name:        "money_transmitter",
		displayName: "Money Transmitter",
		keywords:    []string{"revolut", "paypal", "wise", "transferwise", "venmo", "cash app", "cashapp", "skrill", "neteller", "payoneer", "strike", "zelle", "mbway", "mb way", "bizum", "twint", "satispay", "pix", "promptpay", "gcash", "blik", "vipps", "lydia", "apple pay", "google pay", "mobile"},
	},
	{
		name:        "gift_cards",
		displayName: "Gift Cards",
		keywords:    []string{"gift card", "giftcard", "gift-card", "prepaid", "voucher", "paysafe", "paysafecard", "amazon", "steam", "itunes", "google play card", "neosurf"},
	},
	{
		name:        "crypto",
		displayName: "Crypto",
		keywords:    []string{"lightning", "monero", "usdt", "usdc", "crypto", "onchain", "on-chain"},
	},
}

// classifyMethod returns the group name for the given canonical payment method.
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

// buildGroups takes the raw distinct payment method strings from the DB,
// canonicalizes them via the shared vocabulary (splitting free-text compounds
// like "Instant SEPA Revolut Strike MBWay" into atoms and collapsing spelling
// variants), then organizes the resulting atoms into category groups. Groups
// with no methods are omitted; "other" is always last if non-empty.
func buildGroups(methods []string) []Group {
	// Canonicalize and globally de-duplicate before grouping. Stored offers are
	// already canonicalized at ingestion; doing it again here is idempotent and
	// keeps the category list clean for any rows not yet re-fetched.
	canonical := commonpm.CanonicalizeAll(methods)

	groupMethods := make(map[string][]string)
	for _, m := range canonical {
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
