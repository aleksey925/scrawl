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
	// scopes an API token can be configured with.
	scopeRW = "rw"
	scopeRO = "ro"

	// digestPrefix marks the hashed form of a token secret.
	digestPrefix = "sha256:"

	// tokenBytes is the entropy of a generated token.
	tokenBytes = 32

	// tokenPrefix opens every generated token, so a secret scanner has
	// something to key on when one ends up in a repository or a log.
	tokenPrefix = "scrawl_"

	bearerScheme = "bearer"
)

// apiToken is one configured API client. Only the digest of its secret is kept,
// so a plain entry is hashed once at startup and both forms verify alike.
type apiToken struct {
	name     string
	digest   [sha256.Size]byte
	readOnly bool
	plain    bool // configured as a plain secret, which is warned about at startup
}

// GenerateToken returns a fresh API token to hand to a client.
func GenerateToken() string {
	raw := make([]byte, tokenBytes)
	// crypto/rand.Read never fails, it panics if the system source is broken
	_, _ = rand.Read(raw)
	return tokenPrefix + b64.EncodeToString(raw)
}

// TokenDigest returns the configuration form of a token, which is what the
// tokens list should hold: the token itself never has to be stored anywhere.
// Why the digest is sha256 is in the package doc.
func TokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return digestPrefix + hex.EncodeToString(sum[:])
}

// ByToken reports whether the request was authenticated with an API token
// instead of a session cookie.
func ByToken(r *http.Request) bool {
	_, ok := r.Context().Value(tokenKey{}).(apiToken)
	return ok
}

// ReadOnlyToken reports whether the request was authenticated with a token that
// may read but not write.
func ReadOnlyToken(r *http.Request) bool {
	tok, ok := r.Context().Value(tokenKey{}).(apiToken)
	return ok && tok.readOnly
}

// checkToken looks a presented token up. Every configured entry is compared and
// the loop never breaks early, so the time this takes tells an attacker neither
// which token matched nor how far down the list it sits.
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

// bearerToken returns the credential of an "Authorization: Bearer <token>"
// header. The scheme is matched case-insensitively, as RFC 7235 asks; any other
// scheme is not ours and leaves the request on the cookie path.
//
// A header that names the scheme and carries nothing usable behind it - no
// credential at all, or one behind a tab - is still ours and comes back empty,
// so it is refused as an invalid token instead of quietly falling back to the
// cookie and the public prefixes.
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

// parseTokens reads "bot:sha256:<hex>,reader:plain-secret:ro". Entries are
// separated the same way users are, and the first colon of an entry splits the
// name off. What follows is the secret, either hashed behind "sha256:" or
// plain, with an optional ":ro" or ":rw" scope after it. Blank entries and #
// comments are skipped.
//
// An entry that carries no name is reported by its position and not by its
// text: without a name the whole entry is the secret, and this error reaches
// the log.
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
			// both entries would parse and only one of them ever answer, so a
			// token copied into a second entry would take that entry's scope
			return nil, fmt.Errorf("tokens %q and %q are configured with the same secret, "+
				"which of the two scopes applies would depend on their order", res[twin].name, name)
		}
		res = append(res, tok)
	}
	return res, nil
}

// parseToken turns "secretOrHash[:ro]" into the token it configures. The two
// secret forms know their own shape: the hashed one ends where its digest ends,
// so anything past it is a scope and a wrong one is an error, while a plain
// secret may hold colons of its own and only an exact ":ro" or ":rw" tail is
// read as a scope.
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
		// the offending value stays out of the message: pasting the token where
		// its digest belongs is the likely mistake, and this error is logged
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

// plainTokens returns the names configured with a plain secret, in the order
// they were configured, so the startup warnings come out stable.
func plainTokens(tokens []apiToken) []string {
	res := make([]string, 0, len(tokens))
	for _, tok := range tokens {
		if tok.plain {
			res = append(res, tok.name)
		}
	}
	return res
}
