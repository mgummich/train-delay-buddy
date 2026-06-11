package hafas_test

import (
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func TestIsDBOperator_KnownDB(t *testing.T) {
	for _, op := range []string{
		"DB Fernverkehr AG",
		"DB Regio AG",
		"S-Bahn Berlin GmbH",
		"S-Bahn Hamburg GmbH",
		"S-Bahn München GmbH",
	} {
		if !hafas.IsDBOperator(op) {
			t.Errorf("%q: want IsDBOperator=true", op)
		}
	}
}

func TestIsDBOperator_NonDB(t *testing.T) {
	for _, op := range []string{
		"Flixtrain",
		"Transdev GmbH",
		"",
		"DB Navigator",
		"DB Cargo AG",
	} {
		if hafas.IsDBOperator(op) {
			t.Errorf("%q: want IsDBOperator=false", op)
		}
	}
}

func TestIsDBOnlyJourney_AllDB(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}}},
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Regio AG"}}},
	}
	if !hafas.IsDBOnlyJourney(legs) {
		t.Error("all-DB journey: expected true")
	}
}

func TestIsDBOnlyJourney_MixedFails(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}}},
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "Flixtrain"}}},
	}
	if hafas.IsDBOnlyJourney(legs) {
		t.Error("mixed-operator journey: expected false")
	}
}

func TestIsDBOnlyJourney_WalkingLegIgnored(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}}},
		{Walking: true},
	}
	if !hafas.IsDBOnlyJourney(legs) {
		t.Error("journey with walking segment: expected true (walking ignored)")
	}
}

func TestIsDBOnlyJourney_NilOperatorFails(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: nil}},
	}
	if hafas.IsDBOnlyJourney(legs) {
		t.Error("nil operator: expected false (conservative reject)")
	}
}

func TestIsDBOnlyJourney_EmptyLegsReturnsFalse(t *testing.T) {
	if hafas.IsDBOnlyJourney(nil) {
		t.Error("nil legs: expected false (unclassifiable)")
	}
	if hafas.IsDBOnlyJourney([]hafas.HAFASLeg{}) {
		t.Error("empty legs: expected false (unclassifiable)")
	}
}

func TestIsDBOnlyJourney_AllWalkingReturnsFalse(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Walking: true},
		{Walking: true},
	}
	if hafas.IsDBOnlyJourney(legs) {
		t.Error("all-walking journey: expected false (no transit legs)")
	}
}
