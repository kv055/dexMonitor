# `internal/paymentmethods/groups.go`

Source package: `paymentmethods`  
Source lines: `105`

## Package Purpose

This file contributes to the `paymentmethods` package.

## File Role

This file defines 2 type(s), implements 2 function or method entry point(s), declares 1 package value(s).

## Runtime Behavior

- Serializes or deserializes JSON payloads.

## Types

### `Group`

Group represents a logical payment method category with all raw method strings
that belong to it (as found in the offers table).

Fields:

- `Name` `string`: Name is the name value for the group.
- `DisplayName` `string`: DisplayName is the display name value for the group.
- `Methods` `[]string`: Methods is the methods value for the group.

### `groupRule`

groupRule maps a canonical group name to a list of case-insensitive substrings.
The first matching rule wins — order matters.

Fields:

- `name` `string`: Stores the name value for the group rule.
- `displayName` `string`: Stores the display name value for the group rule.
- `keywords` `[]string`: Stores the keywords value for the group rule.

## Functions and Methods

### `classifyMethod`

classifyMethod returns the group name for the given raw payment method string.
Returns "other" if no rule matches.

Signature: `func classifyMethod(method string) string`

### `buildGroups`

buildGroups takes a list of distinct payment method strings and returns
them organized into Group slices. Groups with no methods are omitted.
The "other" catch-all group is always last if non-empty.

Signature: `func buildGroups(methods []string) []Group`

## Constants and Variables

- `groupRules`: No inline declaration comment is present.

## Key Dependencies

- `strings`

