package authutil

import "testing"

func TestNormalizePhone(t *testing.T) {
	p, err := NormalizePhone("081234567890")
	if err != nil {
		t.Fatal(err)
	}
	if p != "+6281234567890" {
		t.Fatalf("got %s", p)
	}
	p2, err := NormalizePhone("+6281234567890")
	if err != nil || p2 != "+6281234567890" {
		t.Fatalf("e164: %v %s", err, p2)
	}
}

func TestHashTokenStable(t *testing.T) {
	a := HashToken("abc", "secret")
	b := HashToken("abc", "secret")
	if a != b || a == "" {
		t.Fatal("hash not stable")
	}
}
