package authutil

import "testing"

func TestStaffPINRoundTrip(t *testing.T) {
	h, err := HashStaffPIN("1234")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckStaffPIN(h, "1234") {
		t.Fatal("expected match")
	}
	if CheckStaffPIN(h, "9999") {
		t.Fatal("expected mismatch")
	}
}

func TestValidateStaffPIN(t *testing.T) {
	if err := ValidateStaffPIN("12"); err == nil {
		t.Fatal("too short")
	}
	if err := ValidateStaffPIN("0000"); err == nil {
		t.Fatal("all same")
	}
	if err := ValidateStaffPIN("12ab"); err == nil {
		t.Fatal("non-digit")
	}
	if err := ValidateStaffPIN("1234"); err != nil {
		t.Fatal(err)
	}
}
