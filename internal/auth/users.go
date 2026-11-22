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

const maxPasswordLen = 72

var bcryptPrefixes = []string{"$2a$", "$2b$", "$2y$"}

type credential struct {
	hash  []byte
	plain []byte
}

func (c credential) epoch() []byte {
	if c.hash != nil {
		return c.hash
	}
	return c.plain
}

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

func (s *Service) Check(user, password string) bool {
	cred, known := s.users[user]
	if known && cred.hash != nil {
		return bcrypt.CompareHashAndPassword(cred.hash, []byte(password)) == nil
	}
	_ = bcrypt.CompareHashAndPassword(s.dummy(), []byte(password))
	return known && subtle.ConstantTimeCompare(cred.plain, []byte(password)) == 1
}

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

const maxDummyCost = 14
