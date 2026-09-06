// Package auth implements authentication for mdserver: users taken from the
// environment, stateless signed session cookies, the middleware that guards
// the routes and a per-IP login rate limiter.
//
// Users arrive as "name:secret" pairs separated by commas, semicolons or
// newlines. Only the first colon splits a pair, so a password may itself
// contain colons. A secret starting with $2a$, $2b$ or $2y$ is a bcrypt hash,
// anything else is a plain password. Plain passwords work but are logged as a
// warning at startup: the value then sits in the process environment, visible
// through docker inspect and /proc/<pid>/environ.
//
// # The docker-compose $ trap
//
// A bcrypt hash looks like $2a$10$<salt><hash>. Docker Compose interpolates
// $VAR inside an "environment:" block, so every $ has to be doubled there:
//
//	environment:
//	  AUTH_USERS: "alice:$$2a$$10$$C6UzMDM.H6dfI/f/IKcEe.aQ8B4jjM.MU0kEnJk0BF6u"
//
// A file named by "env_file:" is not interpolated, so the hash goes in raw and
// unquoted, which is much harder to get wrong:
//
//	# mdserver.env
//	AUTH_USERS=alice:$2a$10$C6UzMDM.H6dfI/f/IKcEe.aQ8B4jjM.MU0kEnJk0BF6u
//
// A hash that reaches the parser with the doubled $$ still in it is rejected
// with a message pointing back here.
package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// DefaultTTL is the session lifetime used when Config.TTL is not set.
const DefaultTTL = 720 * time.Hour

// Modes for Config.Secure, deciding the Secure flag of the session cookie.
const (
	SecureAuto   = "auto"   // secure whenever the request arrived over TLS
	SecureAlways = "always" // always secure, for an HTTPS-only deployment
	SecureNever  = "never"  // never secure, for plain HTTP on a LAN
)

// defaultPublicPrefixes are served without a session when Config leaves
// PublicPrefixes nil. An empty non-nil slice means nothing is public.
var defaultPublicPrefixes = []string{"/login", "/static", "/ping"}

// Config holds everything the auth service needs. Nothing here is read from
// the command line, main maps its options onto these fields.
type Config struct {
	Users        string        // "user:hashOrPlain,user2:..." pairs
	Secret       string        // signing key, empty means generate and persist
	SecretFile   string        // where a generated secret is persisted
	TTL          time.Duration // session lifetime, DefaultTTL when unset
	Disabled     bool          // serve everything without authentication
	TrustedProxy bool          // trust X-Forwarded-For and X-Forwarded-Proto
	Secure       string        // SecureAuto, SecureAlways or SecureNever

	// PublicPrefixes are the path prefixes the middleware lets through without
	// a session. Nil means defaultPublicPrefixes.
	PublicPrefixes []string
}

// Service verifies passwords, issues and validates session cookies and
// throttles login attempts. It keeps no per-session state, so a restart does
// not log anybody out as long as the signing secret survives.
type Service struct {
	users        map[string]credential
	dummy        func() []byte
	secret       []byte
	ttl          time.Duration
	disabled     bool
	trustedProxy bool
	secure       string
	public       []string
	limiter      *limiter
	now          func() time.Time
}

// NewService parses the users, resolves the signing secret and returns a ready
// service. It fails on a malformed user list, an unknown Secure mode, and on an
// empty user list unless auth is disabled.
func NewService(cfg Config) (*Service, error) {
	users, err := parseUsers(cfg.Users)
	if err != nil {
		return nil, err
	}
	if !cfg.Disabled && len(users) == 0 {
		return nil, errors.New("no users configured, set the users list or disable auth")
	}

	secure := cfg.Secure
	if secure == "" {
		secure = SecureAuto
	}
	if !slices.Contains([]string{SecureAuto, SecureAlways, SecureNever}, secure) {
		return nil, fmt.Errorf("unknown secure mode %q, want %q, %q or %q",
			cfg.Secure, SecureAuto, SecureAlways, SecureNever)
	}

	ttl := cfg.TTL
	if ttl <= 0 {
		ttl = DefaultTTL
	}

	public := cfg.PublicPrefixes
	if public == nil {
		public = defaultPublicPrefixes
	}

	for _, name := range plainUsers(users) {
		log.Printf("[WARN] user %q has a plain password in the configuration, "+
			"generate a bcrypt hash instead: it is visible in docker inspect and /proc/<pid>/environ", name)
	}

	svc := &Service{
		users:        users,
		dummy:        dummyHash(users),
		ttl:          ttl,
		disabled:     cfg.Disabled,
		trustedProxy: cfg.TrustedProxy,
		secure:       secure,
		public:       public,
		limiter:      newLimiter(time.Now()),
		now:          time.Now,
	}
	if !cfg.Disabled {
		svc.secret = loadSecret(cfg.Secret, cfg.SecretFile)
	}
	return svc, nil
}

// userKey is the context key under which the middleware stores the user name.
type userKey struct{}

// Middleware guards the wrapped handler. A request carrying a valid session
// continues with the user name in its context and gets a refreshed cookie once
// half the TTL has passed. A request without one is let through when its path
// matches a public prefix, answered with 401 JSON when it is an API or JSON
// request, and redirected to the login page otherwise. With auth disabled the
// middleware is not installed at all.
func (s *Service) Middleware(next http.Handler) http.Handler {
	if s.disabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tok, ok := s.session(r); ok {
			// the token carries no issue time, so "more than half the ttl has
			// elapsed" is read off the other end: less than half of it is left
			if tok.expiry.Sub(s.now()) < s.ttl/2 {
				s.issue(w, r, tok.user)
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, tok.user)))
			return
		}
		if s.isPublic(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if wantsJSON(r) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		http.Redirect(w, r, "/login?from="+url.QueryEscape(r.URL.RequestURI()), http.StatusFound)
	})
}

// User returns the authenticated user name. With auth disabled it reports an
// empty name and true, so callers do not have to special-case the mode. It
// works both inside and outside Middleware: outside it verifies the cookie.
func (s *Service) User(r *http.Request) (string, bool) {
	if s.disabled {
		return "", true
	}
	if user, ok := r.Context().Value(userKey{}).(string); ok {
		return user, true
	}
	tok, ok := s.session(r)
	if !ok {
		return "", false
	}
	return tok.user, true
}

// Allow reports whether another login attempt from this client is permitted.
// It consumes one attempt from every budget the request counts against, so call
// it once per POST to the login route and refuse the request when it returns
// false.
func (s *Service) Allow(r *http.Request) bool {
	if s.disabled {
		return true
	}
	now := s.now()
	allowed := true
	for _, key := range s.limiterKeys(r) {
		// every budget is charged even once one of them said no, otherwise a
		// forged header would let the peer's own budget refill while it guesses
		allowed = s.limiter.allow(key, now) && allowed
	}
	return allowed
}

// Failed records a rejected login. Enough of them lock the client out for a
// while; SetCookie clears the record on a successful login.
func (s *Service) Failed(r *http.Request) {
	if s.disabled {
		return
	}
	now := s.now()
	for _, key := range s.limiterKeys(r) {
		s.limiter.failed(key, now)
	}
}

// isPublic reports whether path is covered by one of the public prefixes.
func (s *Service) isPublic(path string) bool {
	for _, prefix := range s.public {
		if hasPathPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// hasPathPrefix matches on path segments, so /login covers /login and
// /login/reset but not /loginpage.
func hasPathPrefix(path, prefix string) bool {
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	rest := path[len(prefix):]
	return rest == "" || strings.HasSuffix(prefix, "/") || strings.HasPrefix(rest, "/")
}

// CSRF returns the cross-origin policy for the whole server, so the rules live
// in one place. Go's CrossOriginProtection checks Sec-Fetch-Site and falls back
// to comparing Origin with Host, which needs no token in the templates.
func CSRF() *http.CrossOriginProtection {
	protection := http.NewCrossOriginProtection()
	protection.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if wantsJSON(r) {
			writeJSONError(w, http.StatusForbidden, "cross-origin request blocked")
			return
		}
		http.Error(w, "cross-origin request blocked", http.StatusForbidden)
	}))
	return protection
}
