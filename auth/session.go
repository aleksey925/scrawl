package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	// CookieName is the session cookie scrawl sets.
	CookieName = "scrawl_session"

	tokenSep   = "|"
	tokenParts = 3
	nonceLen   = 16

	secretLen      = 32
	minSecretLen   = 16
	secretFileMode = 0o600
)

// b64 is the encoding used for every binary field of a token: url safe so the
// value survives a cookie unescaped, unpadded so it carries no "=".
var b64 = base64.RawURLEncoding

// unknownEpoch stands in for a user that is not configured, so verifying a
// forged cookie runs the same HMAC as a real one.
var unknownEpoch = []byte("scrawl/unknown-user")

// token is a decoded session cookie.
type token struct {
	user   string
	expiry time.Time
}

// sign builds a cookie value of "user|expiry|nonce|mac", every binary field
// base64url encoded. The nonce makes two logins of the same user in the same
// second produce different cookies.
func (s *Service) sign(user string, expiry time.Time) string {
	nonce := make([]byte, nonceLen)
	// crypto/rand.Read never fails, it panics if the system source is broken
	_, _ = rand.Read(nonce)

	payload := b64.EncodeToString([]byte(user)) + tokenSep +
		strconv.FormatInt(expiry.Unix(), 10) + tokenSep +
		b64.EncodeToString(nonce)
	return payload + tokenSep + b64.EncodeToString(s.mac(payload, user))
}

// parse verifies the signature and the expiry of a cookie value.
func (s *Service) parse(value string, now time.Time) (token, bool) {
	cut := strings.LastIndex(value, tokenSep)
	if cut < 0 {
		return token{}, false
	}
	payload, sig := value[:cut], value[cut+1:]

	parts := strings.Split(payload, tokenSep)
	if len(parts) != tokenParts {
		return token{}, false
	}
	name, err := b64.DecodeString(parts[0])
	if err != nil {
		return token{}, false
	}

	got, err := b64.DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(payload, string(name))) {
		return token{}, false
	}

	unix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return token{}, false
	}
	expiry := time.Unix(unix, 0)
	if !expiry.After(now) {
		return token{}, false
	}
	return token{user: string(name), expiry: expiry}, true
}

// mac signs the payload with the service secret mixed with the user's
// credential epoch, so rotating a password invalidates that user's sessions
// while leaving everybody else logged in.
func (s *Service) mac(payload, user string) []byte {
	epoch := sha256.Sum256(s.epochOf(user))
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	// fixed length, so the payload and the epoch cannot run into each other
	mac.Write(epoch[:])
	return mac.Sum(nil)
}

func (s *Service) epochOf(user string) []byte {
	if cred, ok := s.users[user]; ok {
		return cred.epoch()
	}
	return unknownEpoch
}

// session reads and verifies the session cookie of a request.
func (s *Service) session(r *http.Request) (token, bool) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return token{}, false
	}
	return s.parse(cookie.Value, s.now())
}

// SetCookie issues a session cookie for user and clears the client's failed
// login record, which is what makes a successful login reset the limiter.
func (s *Service) SetCookie(w http.ResponseWriter, r *http.Request, user string) error {
	if s.disabled {
		return nil
	}
	if _, ok := s.users[user]; !ok {
		return fmt.Errorf("cannot issue a session for unknown user %q", user)
	}
	for _, key := range s.limiterKeys(r) {
		s.limiter.reset(key)
	}
	s.issue(w, r, user)
	return nil
}

// issue writes the cookie without touching the limiter, which is what the
// sliding renewal in the middleware needs.
func (s *Service) issue(w http.ResponseWriter, r *http.Request, user string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    s.sign(user, s.now().Add(s.ttl)),
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secureFor(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(s.ttl / time.Second),
	})
}

// ClearCookie expires the session cookie. MaxAge below zero plus an epoch
// Expires covers browsers that ignore one of the two.
func (s *Service) ClearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secureFor(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

// loadSecret resolves the signing key: the configured one wins, otherwise the
// key persisted in file is reused, otherwise a fresh one is generated and
// persisted. It never fails; when nothing can be written it warns and keeps
// the key in memory, which only costs everybody a re-login after a restart.
func loadSecret(secret, file string) []byte {
	if secret != "" {
		if len(secret) < minSecretLen {
			log.Printf("[WARN] the session secret is %d characters, use at least %d", len(secret), minSecretLen)
		}
		// hashing normalizes a passphrase of any length into a full size key
		key := sha256.Sum256([]byte(secret))
		return key[:]
	}

	if file == "" {
		log.Printf("[WARN] no session secret and no secret file configured, " +
			"keeping a generated key in memory: every restart logs all users out")
		return randomSecret()
	}

	if key, ok := readSecretFile(file); ok {
		return key
	}
	key := randomSecret()
	if err := writeSecretFile(file, key); err != nil {
		log.Printf("[WARN] cannot persist the session secret to %s (%v), "+
			"keeping it in memory: every restart logs all users out", file, err)
	}
	return key
}

func randomSecret() []byte {
	key := make([]byte, secretLen)
	// crypto/rand.Read never fails, it panics if the system source is broken
	_, _ = rand.Read(key)
	return key
}

func readSecretFile(path string) ([]byte, bool) {
	raw, err := os.ReadFile(path) //nolint:gosec // the path is operator supplied configuration
	if err != nil {
		return nil, false
	}
	if info, statErr := os.Stat(path); statErr == nil && info.Mode().Perm()&0o077 != 0 {
		log.Printf("[WARN] the session secret file %s is readable by other users, chmod it to 0600", path)
	}
	key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) < secretLen {
		log.Printf("[WARN] the session secret file %s does not hold a usable key, "+
			"generating a new one: all current sessions are dropped", path)
		return nil, false
	}
	return key, true
}

// writeSecretFile persists the key through a temp file in the same directory
// plus a rename, so a crash cannot leave a half written secret behind.
func writeSecretFile(path string, key []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create a temp file in %s: %w", dir, err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }() // a no-op once the rename below succeeded

	if err := fillSecretFile(tmp, hex.EncodeToString(key)+"\n"); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("rename %s to %s: %w", tmp.Name(), path, err)
	}
	return nil
}

func fillSecretFile(file *os.File, data string) error {
	defer file.Close()
	if err := file.Chmod(secretFileMode); err != nil {
		return fmt.Errorf("chmod %s: %w", file.Name(), err)
	}
	if _, err := file.WriteString(data); err != nil {
		return fmt.Errorf("write %s: %w", file.Name(), err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync %s: %w", file.Name(), err)
	}
	return nil
}
