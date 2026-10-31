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
	CookieName = "scrawl_session"

	tokenSep   = "|"
	tokenParts = 3
	nonceLen   = 16

	secretLen      = 32
	minSecretLen   = 16
	secretFileMode = 0o600
)

var b64 = base64.RawURLEncoding

var unknownEpoch = []byte("scrawl/unknown-user")

type token struct {
	user   string
	expiry time.Time
}

func (s *Service) sign(user string, expiry time.Time) string {
	nonce := make([]byte, nonceLen)
	_, _ = rand.Read(nonce)

	payload := b64.EncodeToString([]byte(user)) + tokenSep +
		strconv.FormatInt(expiry.Unix(), 10) + tokenSep +
		b64.EncodeToString(nonce)
	return payload + tokenSep + b64.EncodeToString(s.mac(payload, user))
}

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

func (s *Service) mac(payload, user string) []byte {
	epoch := sha256.Sum256(s.epochOf(user))
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	mac.Write(epoch[:])
	return mac.Sum(nil)
}

func (s *Service) epochOf(user string) []byte {
	if cred, ok := s.users[user]; ok {
		return cred.epoch()
	}
	return unknownEpoch
}

func (s *Service) session(r *http.Request) (token, bool) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return token{}, false
	}
	return s.parse(cookie.Value, s.now())
}

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

func loadSecret(secret, file string) []byte {
	if secret != "" {
		if len(secret) < minSecretLen {
			log.Printf("[WARN] the session secret is %d characters, use at least %d", len(secret), minSecretLen)
		}
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

func writeSecretFile(path string, key []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create a temp file in %s: %w", dir, err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }()

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
