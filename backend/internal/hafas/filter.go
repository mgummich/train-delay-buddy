package hafas

import "strings"

// dbOperators is the allow-list of DB-operated passenger train services.
// Strings must be verified empirically against live db.transport.rest responses.
var dbOperators = map[string]bool{
	"DB Fernverkehr AG":               true, // ICE, IC, EC
	"DB Regio AG":                     true, // Regional trains
	"S-Bahn Berlin GmbH":              true,
	"S-Bahn Hamburg GmbH":             true,
	"S-Bahn München GmbH":             true,
	"DB RegioNetz Infrastruktur GmbH": true,
	"DB Regio Takt GmbH":              true,
}

// IsDBOperator reports whether operatorName is on the DB passenger rail allow-list.
func IsDBOperator(operatorName string) bool {
	return dbOperators[strings.TrimSpace(operatorName)]
}

// IsDBOnlyJourney reports whether all non-walking legs are operated by a DB entity.
// Returns false for nil/empty legs — a journey with no legs is unclassifiable.
func IsDBOnlyJourney(legs []HAFASLeg) bool {
	if len(legs) == 0 {
		return false
	}
	for _, leg := range legs {
		if leg.Walking {
			continue
		}
		if leg.Line == nil || leg.Line.Operator == nil {
			return false
		}
		if !IsDBOperator(leg.Line.Operator.Name) {
			return false
		}
	}
	return true
}
