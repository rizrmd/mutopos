package authutil

import (
	"fmt"
	"regexp"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

const (
	// StaffPINMinLen is the minimum passcode length (Square-style 4–8 digits).
	StaffPINMinLen = 4
	StaffPINMaxLen = 8
	// bcrypt cost — DefaultCost (10) is fine for short numeric PINs at POS scale.
	pinBcryptCost = bcrypt.DefaultCost
)

var pinDigits = regexp.MustCompile(`^\d+$`)

// ValidateStaffPIN checks length and digits-only.
func ValidateStaffPIN(pin string) error {
	if len(pin) < StaffPINMinLen || len(pin) > StaffPINMaxLen {
		return fmt.Errorf("pin must be %d–%d digits", StaffPINMinLen, StaffPINMaxLen)
	}
	if !pinDigits.MatchString(pin) {
		return fmt.Errorf("pin must be digits only")
	}
	// reject trivial all-same (0000) lightly — still allow common demo 1234
	allSame := true
	for _, r := range pin {
		if !unicode.IsDigit(r) {
			return fmt.Errorf("pin must be digits only")
		}
		if r != rune(pin[0]) {
			allSame = false
		}
	}
	if allSame {
		return fmt.Errorf("pin cannot be all the same digit")
	}
	return nil
}

// HashStaffPIN returns a bcrypt hash of the PIN.
func HashStaffPIN(pin string) (string, error) {
	if err := ValidateStaffPIN(pin); err != nil {
		return "", err
	}
	b, err := bcrypt.GenerateFromPassword([]byte(pin), pinBcryptCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CheckStaffPIN compares a plaintext PIN to a stored bcrypt hash.
func CheckStaffPIN(hash, pin string) bool {
	if hash == "" || pin == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pin)) == nil
}
