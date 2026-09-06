package auth

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
)

const apiPrefix = "/api/"

// clientIP is the key the login limiter counts against. The forwarding headers
// are read only with TrustedProxy on, otherwise anybody could pick their own
// bucket by sending a header.
func (s *Service) clientIP(r *http.Request) string {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = r.RemoteAddr
	}
	if !s.trustedProxy {
		return peer
	}

	// take the rightmost address of X-Forwarded-For: our own proxy appends the
	// peer it saw to whatever arrived, so everything left of that last entry is
	// client supplied and can be forged
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		if addr := strings.TrimSpace(parts[i]); net.ParseIP(addr) != nil {
			return addr
		}
	}
	if addr := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(addr) != nil {
		return addr
	}
	return peer
}

// secureFor decides the Secure flag of the session cookie. In the auto mode a
// browser reaching the NAS over plain http on the LAN still keeps its session,
// because a Secure cookie would simply be dropped there.
func (s *Service) secureFor(r *http.Request) bool {
	switch s.secure {
	case SecureAlways:
		return true
	case SecureNever:
		return false
	}
	if r.TLS != nil {
		return true
	}
	if !s.trustedProxy {
		return false
	}
	// the leftmost X-Forwarded-Proto is the scheme the browser actually used,
	// proxies append their own as the chain grows
	proto, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Proto"), ",")
	return strings.EqualFold(strings.TrimSpace(proto), "https")
}

// wantsJSON reports whether the caller expects a JSON error instead of a
// redirect to the login page.
func wantsJSON(r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, apiPrefix) {
		return true
	}
	return strings.Contains(r.Header.Get("Accept"), "application/json")
}

func writeJSONError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// SafeRedirect sanitizes the "from" parameter of the login form. Only a
// path on this very origin is allowed; anything else, including a protocol
// relative "//evil.com" or a header splitting attempt, falls back to "/".
func SafeRedirect(from string) string {
	if from == "" || !strings.HasPrefix(from, "/") {
		return "/"
	}
	// "//host" is protocol relative and "/\host" is normalized to it by
	// browsers, both leave the origin
	if strings.HasPrefix(from, "//") || strings.HasPrefix(from, `/\`) {
		return "/"
	}
	// a raw CR or LF would let the value split the Location header
	if strings.ContainsAny(from, "\r\n\x00") {
		return "/"
	}

	parsed, err := url.Parse(from)
	if err != nil || parsed.Scheme != "" || parsed.Opaque != "" || parsed.Host != "" || parsed.User != nil {
		return "/"
	}
	res := parsed.EscapedPath()
	if !strings.HasPrefix(res, "/") {
		return "/"
	}
	if parsed.RawQuery != "" {
		res += "?" + parsed.RawQuery
	}
	if parsed.Fragment != "" {
		res += "#" + parsed.EscapedFragment()
	}
	return res
}
