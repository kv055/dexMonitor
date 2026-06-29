package paymentmethods

import (
	"regexp"
	"strings"
)

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

type normalizeRule struct {
	pattern   *regexp.Regexp
	canonical string
}

var normalizeRules = []normalizeRule{
	// Money Transmitters
	{regexp.MustCompile(`(?i)^cash[\s_-]*app$`), "Cash App"},
	{regexp.MustCompile(`(?i)^pay[\s_-]*pal$`), "PayPal"},
	{regexp.MustCompile(`(?i)^(transfer[\s_-]*wise|wise)$`), "Wise"},
	{regexp.MustCompile(`(?i)^mb[\s_-]*way$`), "MB Way"},
	{regexp.MustCompile(`(?i)^apple[\s_-]*pay$`), "Apple Pay"},
	{regexp.MustCompile(`(?i)^google[\s_-]*pay$`), "Google Pay"},
	{regexp.MustCompile(`(?i)^prompt[\s_-]*pay$`), "PromptPay"},
	{regexp.MustCompile(`(?i)^g[\s_-]*cash$`), "GCash"},

	// Bank Transfers
	{regexp.MustCompile(`(?i)^sepa[\s_-]*instant$`), "SEPA Instant"},
	{regexp.MustCompile(`(?i)^instant[\s_-]*sepa$`), "SEPA Instant"},
	{regexp.MustCompile(`(?i)^sepa$`), "SEPA"},
	{regexp.MustCompile(`(?i)^national[\s_-]*bank$`), "National Bank"},
	{regexp.MustCompile(`(?i)^national[\s_-]*transfer$`), "National Transfer"},
	{regexp.MustCompile(`(?i)^bank[\s_-]*transfer$`), "Bank Transfer"},
	{regexp.MustCompile(`(?i)^faster[\s_-]*payments?$`), "Faster Payments"},

	// Gift Cards / Prepaid
	{regexp.MustCompile(`(?i)^paysafe[\s_-]*(card)?$`), "Paysafecard"},
	{regexp.MustCompile(`(?i)^gift[\s_-]*cards?$`), "Gift Card"},
	{regexp.MustCompile(`(?i)^google[\s_-]*play[\s_-]*card$`), "Google Play Card"},

	// Cash / In-Person
	{regexp.MustCompile(`(?i)^(face[\s_-]*to[\s_-]*face|f2f)$`), "Face to Face"},
	{regexp.MustCompile(`(?i)^in[\s_-]*person$`), "In Person"},

	// Crypto
	{regexp.MustCompile(`(?i)^on[\s_-]*chain$`), "On-Chain"},
}

// compoundMethodRe tokenises a compound Bisq2 payment-method string such as
// "Instant SEPA Revolut Strike MBWay" into individual method names.
// Multi-word alternatives are listed longest-first; the final \S+ catches any
// remaining single-word method name.
var compoundMethodRe = regexp.MustCompile(`(?i)` +
	`Paypal\s+Friends\s*&\s*Family` +
	`|Amazon\s+\w+\s+GiftCard` +
	`|Google\s+Play\s+Card` +
	`|Instant\s+SEPA` +
	`|SEPA\s+Instant` +
	`|Faster\s+Payments?` +
	`|National\s+(?:Bank|Transfer)` +
	`|Bank\s+Transfer` +
	`|Cash\s+App` +
	`|Apple\s+Pay` +
	`|Google\s+Pay` +
	`|Face\s+to\s+Face` +
	`|In\s+Person` +
	`|MB\s+Way` +
	`|On[\s-]+Chain` +
	`|\S+`)

func isKnownMethod(method string) bool {
	trimmed := strings.TrimSpace(method)
	for _, rule := range normalizeRules {
		if rule.pattern.MatchString(trimmed) {
			return true
		}
	}
	return false
}

// splitCompoundMethod splits a compound method string into individual methods.
// Single methods (known multi-word names or single words) pass through unchanged.
func splitCompoundMethod(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if isKnownMethod(s) || !strings.Contains(s, " ") {
		return []string{s}
	}
	parts := compoundMethodRe.FindAllString(s, -1)
	if len(parts) == 0 {
		return []string{s}
	}
	return parts
}

func normalizeMethod(method string) string {
	trimmed := strings.TrimSpace(method)
	for _, rule := range normalizeRules {
		if rule.pattern.MatchString(trimmed) {
			return rule.canonical
		}
	}
	return trimmed
}

func deduplicateMethods(methods []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, m := range methods {
		canon := normalizeMethod(m)
		key := strings.ToLower(canon)
		if !seen[key] {
			seen[key] = true
			result = append(result, canon)
		}
	}
	return result
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
	// Split compound strings (e.g. "Instant SEPA Revolut Strike MBWay")
	// into individual methods before classifying.
	var expanded []string
	for _, m := range methods {
		expanded = append(expanded, splitCompoundMethod(m)...)
	}

	groupMethods := make(map[string][]string)
	for _, m := range expanded {
		key := classifyMethod(m)
		groupMethods[key] = append(groupMethods[key], m)
	}

	// Build result in rule order, then "other".
	// Normalize and deduplicate method names within each group.
	var groups []Group
	for _, rule := range groupRules {
		ms := groupMethods[rule.name]
		if len(ms) == 0 {
			continue
		}
		groups = append(groups, Group{
			Name:        rule.name,
			DisplayName: rule.displayName,
			Methods:     deduplicateMethods(ms),
		})
	}
	if other := groupMethods["other"]; len(other) > 0 {
		groups = append(groups, Group{
			Name:        "other",
			DisplayName: "Other",
			Methods:     deduplicateMethods(other),
		})
	}
	return groups
}
