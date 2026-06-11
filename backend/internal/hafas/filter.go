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
// Journeys where any leg has an unknown or non-DB operator return false.
func IsDBOnlyJourney(legs []HAFASLeg) bool {
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
