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

// buildGroups takes the raw distinct payment method strings from the DB,
// canonicalizes them via the given registry (built from the payment_methods
// table), then organizes the resulting atoms into category groups. Groups
// with no methods are omitted; "others" is always last if non-empty.
func buildGroups(reg *commonpm.Registry, methods []string) []Group {
	canonical := reg.CanonicalizeDistinct(methods)

	groupMethods := make(map[string][]string)
	for _, m := range canonical {
		key := reg.CategoryOf(m)
		groupMethods[key] = append(groupMethods[key], m)
	}

	var groups []Group
	for _, cat := range commonpm.CategoryOrder() {
		if cat == commonpm.CategoryOthers {
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
	if other := groupMethods[commonpm.CategoryOthers]; len(other) > 0 {
		groups = append(groups, Group{
			Name:        commonpm.CategoryOthers,
			DisplayName: commonpm.CategoryDisplayName(commonpm.CategoryOthers),
			Methods:     other,
		})
	}
	return groups
}
