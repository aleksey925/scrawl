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

const DefaultTTL = 720 * time.Hour

const (
	SecureAuto   = "auto"
	SecureAlways = "always"
	SecureNever  = "never"
)

var defaultPublicPrefixes = []string{"/login", "/api/login", "/manifest.webmanifest", "/static", "/ping"}

type Config struct {
	Users        string
	Tokens       string
	Secret       string
	SecretFile   string
	TTL          time.Duration
	Disabled     bool
	TrustedProxy bool
	Secure       string

	PublicPrefixes []string

	PublicPaths []string
}

type Service struct {
	users        map[string]credential
	tokens       []apiToken
	dummy        func() []byte
	secret       []byte
	ttl          time.Duration
	disabled     bool
	trustedProxy bool
	secure       string
	public       []string
	publicPaths  []string
	limiter      *limiter
	now          func() time.Time
}

func NewService(cfg Config) (*Service, error) {
	users, err := parseUsers(cfg.Users)
	if err != nil {
		return nil, err
	}
	tokens, err := parseTokens(cfg.Tokens)
	if err != nil {
		return nil, err
	}
	if !cfg.Disabled && len(users) == 0 && len(tokens) == 0 {
		return nil, errors.New("no users and no tokens configured, set one of the lists or disable auth")
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

	for _, name := range plainTokens(tokens) {
		log.Printf("[WARN] token %q is configured in plain form, store its sha256 digest instead "+
			"(scrawl token): it is visible in docker inspect and /proc/<pid>/environ", name)
	}

	for _, tok := range tokens {
		if _, taken := users[tok.name]; taken {
			log.Printf("[WARN] %q names both a user and a token, so nothing in the log tells the two apart, "+
				"rename one of them", tok.name)
		}
	}

	svc := &Service{
		users:        users,
		tokens:       tokens,
		dummy:        dummyHash(users),
		ttl:          ttl,
		disabled:     cfg.Disabled,
		trustedProxy: cfg.TrustedProxy,
		secure:       secure,
		public:       public,
		publicPaths:  cfg.PublicPaths,
		limiter:      newLimiter(time.Now()),
		now:          time.Now,
	}
	if !cfg.Disabled {
		svc.secret = loadSecret(cfg.Secret, cfg.SecretFile)
	}
	return svc, nil
}

type userKey struct{}

type tokenKey struct{}

func (s *Service) Middleware(next http.Handler) http.Handler {
	if s.disabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if presented, ok := bearerToken(r); ok {
			tok, valid := s.checkToken(presented)
			if !valid {
				writeJSONError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tokenKey{}, tok)))
			return
		}
		if tok, ok := s.session(r); ok {
			if !background(r) && tok.expiry.Sub(s.now()) < s.ttl/2 {
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

func (s *Service) User(r *http.Request) (string, bool) {
	if s.disabled {
		return "", true
	}
	if tok, ok := r.Context().Value(tokenKey{}).(apiToken); ok {
		return tok.name, true
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

const (
	anonymousActor   = "anonymous"
	tokenActorPrefix = "token:"
)

func (s *Service) Actor(r *http.Request) string {
	name, ok := s.User(r)
	if !ok || name == "" {
		return anonymousActor
	}
	if ByToken(r) {
		return tokenActorPrefix + name
	}
	return name
}

func (s *Service) Allow(r *http.Request) bool {
	if s.disabled {
		return true
	}
	now := s.now()
	allowed := true
	for _, key := range s.limiterKeys(r) {
		allowed = s.limiter.allow(key, now) && allowed
	}
	return allowed
}

func (s *Service) Failed(r *http.Request) {
	if s.disabled {
		return
	}
	now := s.now()
	for _, key := range s.limiterKeys(r) {
		s.limiter.failed(key, now)
	}
}

func (s *Service) isPublic(path string) bool {
	for _, prefix := range s.public {
		if hasPathPrefix(path, prefix) {
			return true
		}
	}
	return slices.Contains(s.publicPaths, path)
}

func hasPathPrefix(path, prefix string) bool {
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	rest := path[len(prefix):]
	return rest == "" || strings.HasSuffix(prefix, "/") || strings.HasPrefix(rest, "/")
}

func CSRF() func(http.Handler) http.Handler {
	protection := http.NewCrossOriginProtection()
	protection.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if wantsJSON(r) {
			writeJSONError(w, http.StatusForbidden, "cross-origin request blocked")
			return
		}
		http.Error(w, "cross-origin request blocked", http.StatusForbidden)
	}))

	return func(next http.Handler) http.Handler {
		checked := protection.Handler(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if ByToken(r) {
				next.ServeHTTP(w, r)
				return
			}
			checked.ServeHTTP(w, r)
		})
	}
}
