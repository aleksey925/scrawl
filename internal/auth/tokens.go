package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"slices"
	"strings"
)

const (
	scopeRW = "rw"
	scopeRO = "ro"

	digestPrefix = "sha256:"

	tokenBytes = 32

	tokenPrefix = "scrawl_"

	bearerScheme = "bearer"
)

type apiToken struct {
	name     string
	digest   [sha256.Size]byte
	readOnly bool
	plain    bool
}

func GenerateToken() string {
	raw := make([]byte, tokenBytes)
	_, _ = rand.Read(raw)
	return tokenPrefix + b64.EncodeToString(raw)
}

func TokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return digestPrefix + hex.EncodeToString(sum[:])
}

func ByToken(r *http.Request) bool {
	_, ok := r.Context().Value(tokenKey{}).(apiToken)
	return ok
}

func ReadOnlyToken(r *http.Request) bool {
	tok, ok := r.Context().Value(tokenKey{}).(apiToken)
	return ok && tok.readOnly
}

func (s *Service) checkToken(presented string) (apiToken, bool) {
	digest := sha256.Sum256([]byte(presented))
	res, found := apiToken{}, false
	for _, tok := range s.tokens {
		if subtle.ConstantTimeCompare(digest[:], tok.digest[:]) == 1 {
			res, found = tok, true
		}
	}
	return res, found
}

func bearerToken(r *http.Request) (string, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	scheme, credential := header, ""
	if cut := strings.IndexAny(header, " \t"); cut >= 0 {
		scheme, credential = header[:cut], header[cut+1:]
	}
	if !strings.EqualFold(scheme, bearerScheme) {
		return "", false
	}
	return strings.TrimSpace(credential), true
}

func parseTokens(spec string) ([]apiToken, error) {
	fields := strings.FieldsFunc(spec, isUserSeparator)
	res := make([]apiToken, 0, len(fields))
	for _, field := range fields {
		entry := strings.TrimSpace(field)
		if entry == "" || strings.HasPrefix(entry, "#") {
			continue
		}
		name, secret, found := strings.Cut(entry, ":")
		if !found {
			return nil, fmt.Errorf("bad token entry %d: want name:tokenHashOrPlain[:ro], "+
				"got %d characters and no colon", len(res)+1, len(entry))
		}
		name, secret = strings.TrimSpace(name), strings.TrimSpace(secret)
		if name == "" {
			return nil, fmt.Errorf("bad token entry %d: empty token name", len(res)+1)
		}
		if slices.ContainsFunc(res, func(configured apiToken) bool { return configured.name == name }) {
			return nil, fmt.Errorf("token %q is configured twice", name)
		}
		tok, err := parseToken(name, secret)
		if err != nil {
			return nil, err
		}
		twin := slices.IndexFunc(res, func(configured apiToken) bool { return configured.digest == tok.digest })
		if twin >= 0 {
			return nil, fmt.Errorf("tokens %q and %q are configured with the same secret, "+
				"which of the two scopes applies would depend on their order", res[twin].name, name)
		}
		res = append(res, tok)
	}
	return res, nil
}

func parseToken(name, secret string) (apiToken, error) {
	if digest, hashed := strings.CutPrefix(secret, digestPrefix); hashed {
		return parseHashedToken(name, digest)
	}

	value, readOnly := cutScope(secret)
	if value == "" {
		return apiToken{}, fmt.Errorf("token %q: empty secret", name)
	}
	return apiToken{name: name, digest: sha256.Sum256([]byte(value)), readOnly: readOnly, plain: true}, nil
}

func parseHashedToken(name, rest string) (apiToken, error) {
	digest, scope, _ := strings.Cut(rest, ":")
	readOnly, err := parseScope(name, scope)
	if err != nil {
		return apiToken{}, err
	}
	raw, err := hex.DecodeString(digest)
	if err != nil || len(raw) != sha256.Size {
		return apiToken{}, fmt.Errorf("token %q: the value after %q is not a sha256 digest, "+
			"want %d hex characters, got %d", name, digestPrefix, sha256.Size*2, len(digest))
	}
	return apiToken{name: name, digest: [sha256.Size]byte(raw), readOnly: readOnly}, nil
}

func parseScope(name, scope string) (bool, error) {
	switch scope {
	case "", scopeRW:
		return false, nil
	case scopeRO:
		return true, nil
	}
	return false, fmt.Errorf("token %q: unknown scope %q, want %q or %q", name, scope, scopeRO, scopeRW)
}

func cutScope(secret string) (string, bool) {
	if rest, found := strings.CutSuffix(secret, ":"+scopeRO); found {
		return rest, true
	}
	rest, _ := strings.CutSuffix(secret, ":"+scopeRW)
	return rest, false
}

func plainTokens(tokens []apiToken) []string {
	res := make([]string, 0, len(tokens))
	for _, tok := range tokens {
		if tok.plain {
			res = append(res, tok.name)
		}
	}
	return res
}
