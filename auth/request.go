package auth

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
)

const (
	apiPrefix = "/api/"
	// projectPrefix is where every project's own URL space begins. auth knows
	// it only to tell a project's API apart from its pages.
	projectPrefix = "/p/"
)

// limiterKeys are the buckets one login attempt is counted against. The peer
// address is always one of them: with TrustedProxy on the derived client ip
// comes from a header, and a proxy that sets only X-Real-IP or nothing at all
// leaves that header entirely client supplied, so a forged one must never buy
// more attempts than the peer behind it already has.
func (s *Service) limiterKeys(r *http.Request) []string {
	peer := peerIP(r)
	client := s.clientIP(r)
	if client == peer {
		return []string{peer}
	}
	return []string{peer, client}
}

// peerIP is the address of the connection itself, which no header can change.
func peerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// clientIP is the address the client is reported at. The forwarding headers are
// read only with TrustedProxy on, otherwise anybody could pick their own bucket
// by sending a header.
func (s *Service) clientIP(r *http.Request) string {
	peer := peerIP(r)
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
	if isAPIPath(r.URL.Path) {
		return true
	}
	return strings.Contains(r.Header.Get("Accept"), "application/json")
}

// isAPIPath reports whether a path names an API endpoint. There are two of
// them: the global routes at the root, and a project's own under /p/<name>/api.
// The question is structural rather than a list of configured projects, so
// nothing here has to be told when one is added, and an API client that omits
// Accept still gets a JSON 401 instead of a redirect to an HTML form.
func isAPIPath(p string) bool {
	if strings.HasPrefix(p, apiPrefix) {
		return true
	}
	rest, ok := strings.CutPrefix(p, projectPrefix)
	if !ok {
		return false
	}
	name, rest, ok := strings.Cut(rest, "/")
	return ok && name != "" && (rest == "api" || strings.HasPrefix(rest, "api/"))
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
