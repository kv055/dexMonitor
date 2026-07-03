package paymentmethods

import (
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

// classifyMethod returns the category for the given canonical payment method.
func classifyMethod(method string) string {
	return commonpm.CategoryOf(method)
}

// buildGroups takes the raw distinct payment method strings from the DB,
// canonicalizes them via the shared registry, then organizes the resulting atoms
// into category groups. Groups with no methods are omitted; "other" is always
// last if non-empty.
func buildGroups(methods []string) []Group {
	canonical := commonpm.CanonicalizeDistinct(methods)

	groupMethods := make(map[string][]string)
	for _, m := range canonical {
		key := classifyMethod(m)
		groupMethods[key] = append(groupMethods[key], m)
	}

	var groups []Group
	for _, cat := range commonpm.CategoryOrder() {
		if cat == commonpm.CategoryOther {
			continue
		}
		ms := groupMethods[cat]
		if len(ms) == 0 {
			continue
		}
		groups = append(groups, Group{
			Name:        cat,
			DisplayName: commonpm.CategoryDisplayName(cat),
			Methods:     ms,
		})
	}
	if other := groupMethods[commonpm.CategoryOther]; len(other) > 0 {
		groups = append(groups, Group{
			Name:        commonpm.CategoryOther,
			DisplayName: commonpm.CategoryDisplayName(commonpm.CategoryOther),
			Methods:     other,
		})
	}
	return groups
}
