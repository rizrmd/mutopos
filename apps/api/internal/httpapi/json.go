package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(true)
	_ = enc.Encode(body)
}

func writeErr(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, apiError{Error: code, Message: message})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	return nil
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	const p = "Bearer "
	if !strings.HasPrefix(h, p) && !strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return ""
	}
	// case-insensitive Bearer
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func headerOrQuery(r *http.Request, header, query string) string {
	if v := strings.TrimSpace(r.Header.Get(header)); v != "" {
		return v
	}
	return strings.TrimSpace(r.URL.Query().Get(query))
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// pgx/pgconn: SQLSTATE 23505
	s := err.Error()
	return strings.Contains(s, "23505") || strings.Contains(s, "duplicate key") || strings.Contains(s, "unique constraint")
}

func badRequest(err error) string {
	if err == nil {
		return "invalid request"
	}
	var se *json.SyntaxError
	var te *json.UnmarshalTypeError
	switch {
	case errors.As(err, &se), errors.As(err, &te):
		return "invalid JSON body"
	default:
		return err.Error()
	}
}
