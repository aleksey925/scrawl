package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"golang.org/x/crypto/bcrypt"
)

// maxPasswordLen is bcrypt's key limit: longer keys are silently truncated by
// the algorithm and rejected outright by bcrypt.GenerateFromPassword.
const maxPasswordLen = 72

// bcryptPrefixes are the hash identifiers golang.org/x/crypto/bcrypt accepts.
var bcryptPrefixes = []string{"$2a$", "$2b$", "$2y$"}

// credential is one configured user's secret. Exactly one field is set.
type credential struct {
	hash  []byte // bcrypt hash
	plain []byte // plain password, tolerated but warned about
}

// epoch returns the bytes a session is pinned to. Rotating a user's password
// changes them, and every cookie signed under the old secret stops verifying:
// that is the only revocation a stateless session can offer.
func (c credential) epoch() []byte {
	if c.hash != nil {
		return c.hash
	}
	return c.plain
}

// HashPassword returns a bcrypt hash suitable for the users configuration.
func HashPassword(password string) (string, error) {
	if password == "" {
		return "", errors.New("password must not be empty")
	}
	if len(password) > maxPasswordLen {
		return "", fmt.Errorf("password is %d bytes, bcrypt accepts at most %d", len(password), maxPasswordLen)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("generate bcrypt hash: %w", err)
	}
	return string(hash), nil
}

// Check verifies a login. Every outcome costs one bcrypt comparison: an
// unknown user and a plain password both burn one against a throwaway hash, so
// the response time does not tell an attacker which user names exist.
func (s *Service) Check(user, password string) bool {
	cred, known := s.users[user]
	if known && cred.hash != nil {
		return bcrypt.CompareHashAndPassword(cred.hash, []byte(password)) == nil
	}
	_ = bcrypt.CompareHashAndPassword(s.dummy(), []byte(password))
	return known && subtle.ConstantTimeCompare(cred.plain, []byte(password)) == 1
}

// parseUsers reads "alice:$2a$10$...,bob:secret". Entries are separated by
// commas, semicolons or newlines; only the first colon of an entry splits it,
// because a password may contain colons and a bcrypt hash is full of $ . / and
// base64 characters. Blank entries and # comments are skipped.
func parseUsers(spec string) (map[string]credential, error) {
	res := map[string]credential{}
	for _, entry := range strings.FieldsFunc(spec, isUserSeparator) {
		entry = strings.TrimSpace(entry)
		if entry == "" || strings.HasPrefix(entry, "#") {
			continue
		}
		name, secret, found := strings.Cut(entry, ":")
		if !found {
			return nil, fmt.Errorf("bad user entry %q: want name:hashOrPassword", entry)
		}
		name, secret = strings.TrimSpace(name), strings.TrimSpace(secret)
		if name == "" {
			return nil, fmt.Errorf("bad user entry %q: empty user name", entry)
		}
		if secret == "" {
			return nil, fmt.Errorf("user %q: empty password", name)
		}
		if _, dup := res[name]; dup {
			return nil, fmt.Errorf("user %q is configured twice", name)
		}
		cred, err := parseCredential(name, secret)
		if err != nil {
			return nil, err
		}
		res[name] = cred
	}
	return res, nil
}

func isUserSeparator(r rune) bool {
	return r == ',' || r == ';' || r == '\n' || r == '\r'
}

func parseCredential(name, secret string) (credential, error) {
	if !isBcryptHash(secret) {
		if strings.HasPrefix(secret, "$$2") {
			return credential{}, fmt.Errorf("user %q: the bcrypt hash still carries doubled $$, "+
				"docker-compose interpolation mangled it - use an env_file or double every $", name)
		}
		return credential{plain: []byte(secret)}, nil
	}
	if _, err := bcrypt.Cost([]byte(secret)); err != nil {
		return credential{}, fmt.Errorf("user %q: broken bcrypt hash: %w", name, err)
	}
	return credential{hash: []byte(secret)}, nil
}

func isBcryptHash(secret string) bool {
	return slices.ContainsFunc(bcryptPrefixes, func(prefix string) bool {
		return strings.HasPrefix(secret, prefix)
	})
}

// plainUsers returns the names configured with a plain password, sorted so the
// startup warnings come out in a stable order.
func plainUsers(users map[string]credential) []string {
	res := make([]string, 0, len(users))
	for name, cred := range users {
		if cred.hash == nil {
			res = append(res, name)
		}
	}
	slices.Sort(res)
	return res
}

// dummyHash builds the throwaway hash Check compares against when no real
// bcrypt comparison would happen. It matches the highest cost in use, so the
// timing-equalized path is as expensive as the real one, and it is generated
// lazily so a service that never checks a password never pays for it.
func dummyHash(users map[string]credential) func() []byte {
	cost := bcrypt.DefaultCost
	for _, cred := range users {
		if cred.hash == nil {
			continue
		}
		if c, err := bcrypt.Cost(cred.hash); err == nil && c > cost {
			cost = c
		}
	}
	cost = min(cost, maxDummyCost)

	return sync.OnceValue(func() []byte {
		hash, err := bcrypt.GenerateFromPassword([]byte(rand.Text()), cost)
		if err != nil {
			return nil
		}
		return hash
	})
}

// maxDummyCost caps the work the equalizing comparison does: past it a single
// login would take seconds and the timing leak is the smaller problem.
const maxDummyCost = 14
