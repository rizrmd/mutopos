package authutil

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// NewToken returns a cryptographically random opaque token (hex).
func NewToken(nbytes int) (string, error) {
	if nbytes < 16 {
		nbytes = 32
	}
	b := make([]byte, nbytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HashToken stores only a digest of the bearer token (plus optional secret).
func HashToken(token, secret string) string {
	sum := sha256.Sum256([]byte(secret + ":" + token))
	return hex.EncodeToString(sum[:])
}

// HashOTP hashes an OTP code for auth_challenges.code_hash.
func HashOTP(code, secret string) string {
	sum := sha256.Sum256([]byte("otp:" + secret + ":" + code))
	return hex.EncodeToString(sum[:])
}

// NormalizePhone trims spaces; expects E.164 starting with +.
func NormalizePhone(phone string) (string, error) {
	p := strings.TrimSpace(phone)
	p = strings.ReplaceAll(p, " ", "")
	p = strings.ReplaceAll(p, "-", "")
	if p == "" {
		return "", fmt.Errorf("phone_e164 is required")
	}
	if !strings.HasPrefix(p, "+") {
		// Common ID local form 08… → +62…
		if strings.HasPrefix(p, "08") {
			p = "+62" + p[1:]
		} else if strings.HasPrefix(p, "62") {
			p = "+" + p
		} else {
			return "", fmt.Errorf("phone_e164 must be E.164 (e.g. +6281234567890)")
		}
	}
	if len(p) < 10 || len(p) > 20 {
		return "", fmt.Errorf("phone_e164 length invalid")
	}
	for i, r := range p {
		if i == 0 {
			continue
		}
		if r < '0' || r > '9' {
			return "", fmt.Errorf("phone_e164 must be digits after +")
		}
	}
	return p, nil
}
