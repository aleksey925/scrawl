package auth

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
)

const (
	apiPrefix   = "/api/"
	spacePrefix = "/s/"
)

func (s *Service) limiterKeys(r *http.Request) []string {
	peer := peerIP(r)
	client := s.clientIP(r)
	if client == peer {
		return []string{peer}
	}
	return []string{peer, client}
}

func peerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Service) clientIP(r *http.Request) string {
	peer := peerIP(r)
	if !s.trustedProxy {
		return peer
	}

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
	proto, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Proto"), ",")
	return strings.EqualFold(strings.TrimSpace(proto), "https")
}

func wantsJSON(r *http.Request) bool {
	if isAPIPath(r.URL.Path) {
		return true
	}
	return strings.Contains(r.Header.Get("Accept"), "application/json")
}

func isAPIPath(p string) bool {
	if strings.HasPrefix(p, apiPrefix) {
		return true
	}
	rest, ok := strings.CutPrefix(p, spacePrefix)
	if !ok {
		return false
	}
	name, rest, ok := strings.Cut(rest, "/")
	return ok && name != "" && (rest == "api" || strings.HasPrefix(rest, "api/"))
}

const backgroundHeader = "X-Scrawl-Background"

func background(r *http.Request) bool {
	return r.Header.Get(backgroundHeader) == "1"
}

func writeJSONError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func SafeRedirect(from string) string {
	if from == "" || !strings.HasPrefix(from, "/") {
		return "/"
	}
	if strings.HasPrefix(from, "//") || strings.HasPrefix(from, `/\`) {
		return "/"
	}
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
