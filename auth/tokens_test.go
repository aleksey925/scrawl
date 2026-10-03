package auth

import (
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testAPIToken and testReadToken are the values a client presents; the
// configuration in the tests holds their digests.
const (
	testAPIToken  = "scrawl_read-write-token"
	testReadToken = "scrawl_read-only-token"
)

func TestParseTokens(t *testing.T) {
	upperDigest := digestPrefix + strings.ToUpper(strings.TrimPrefix(TokenDigest(testAPIToken), digestPrefix))

	tests := []struct {
		name   string
		spec   string
		tokens []apiToken
		err    string
	}{
		{name: "empty input", spec: "", tokens: []apiToken{}},
		{name: "only separators", spec: " , ; \n ", tokens: []apiToken{}},
		{
			name: "hashed token", spec: "bot:" + TokenDigest(testAPIToken),
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte(testAPIToken))}},
		},
		{
			name: "plain token", spec: "bot:secret",
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte("secret")), plain: true}},
		},
		{
			name: "a plain token keeps its colons", spec: "bot:a:b",
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte("a:b")), plain: true}},
		},
		{
			name: "uppercase digest", spec: "bot:" + upperDigest,
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte(testAPIToken))}},
		},
		{
			name: "read-only scope", spec: "bot:" + TokenDigest(testReadToken) + ":ro",
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte(testReadToken)), readOnly: true}},
		},
		{
			name: "explicit read-write scope", spec: "bot:" + TokenDigest(testAPIToken) + ":rw",
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte(testAPIToken))}},
		},
		{
			name: "read-only scope on a plain token", spec: "bot:secret:ro",
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte("secret")), readOnly: true, plain: true}},
		},
		{
			name: "surrounding whitespace is trimmed", spec: "  bot : secret  ",
			tokens: []apiToken{{name: "bot", digest: sha256.Sum256([]byte("secret")), plain: true}},
		},
		{
			name: "separators and comments", spec: "# clients\nbot:one;reader:two:ro\r\nother:three",
			tokens: []apiToken{
				{name: "bot", digest: sha256.Sum256([]byte("one")), plain: true},
				{name: "reader", digest: sha256.Sum256([]byte("two")), readOnly: true, plain: true},
				{name: "other", digest: sha256.Sum256([]byte("three")), plain: true},
			},
		},
		{
			name: "no colon", spec: "bot",
			err: "bad token entry 1: want name:tokenHashOrPlain[:ro], got 3 characters and no colon",
		},
		{name: "empty name", spec: ":secret", err: "bad token entry 1: empty token name"},
		{name: "the position counts the entries", spec: "bot:one,reader", err: "bad token entry 2:"},
		{name: "empty secret", spec: "bot:", err: `token "bot": empty secret`},
		{name: "empty secret with a scope", spec: "bot::ro", err: `token "bot": empty secret`},
		{name: "duplicate name", spec: "bot:one,bot:two", err: `token "bot" is configured twice`},
		{
			name: "duplicate secret", spec: "reader:secret:ro,bot:secret",
			err: `tokens "reader" and "bot" are configured with the same secret`,
		},
		{
			name: "the same secret in both forms", spec: "bot:" + TokenDigest(testAPIToken) + ",reader:" + testAPIToken,
			err: `tokens "bot" and "reader" are configured with the same secret`,
		},
		{
			name: "short digest", spec: "bot:sha256:abcd",
			err: `token "bot": the value after "sha256:" is not a sha256 digest, want 64 hex characters, got 4`,
		},
		{
			name: "digest that is not hex", spec: "bot:sha256:" + strings.Repeat("z", sha256.Size*2),
			err: "is not a sha256 digest, want 64 hex characters, got 64",
		},
		{
			name: "unknown scope", spec: "bot:" + TokenDigest(testAPIToken) + ":admin",
			err: `token "bot": unknown scope "admin", want "ro" or "rw"`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tokens, err := parseTokens(tc.spec)
			if tc.err != "" {
				assert.Nil(t, tokens)
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.tokens, tokens)
		})
	}
}

func TestParseTokensNeverEchoesASecret(t *testing.T) {
	token := GenerateToken()

	tests := []struct {
		name string
		spec string
	}{
		{name: "the token pasted where its digest belongs", spec: "bot:" + digestPrefix + token},
		{name: "the name forgotten, so the entry is the token", spec: token},
		{name: "an empty name", spec: ":" + token},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			tokens, err := parseTokens(tc.spec)

			// assert
			assert.Nil(t, tokens)
			require.Error(t, err)
			assert.NotContains(t, err.Error(), token)
		})
	}
}

func TestPlainTokens(t *testing.T) {
	// arrange
	tokens, err := parseTokens("bot:" + TokenDigest(testAPIToken) + ",reader:plain-one:ro,other:plain-two")

	// act & assert
	require.NoError(t, err)
	assert.Equal(t, []string{"reader", "other"}, plainTokens(tokens))
}

func TestServiceCheckToken(t *testing.T) {
	svc := newTestService(t, Config{
		Tokens: "bot:" + TokenDigest(testAPIToken) + ",reader:" + testReadToken + ":ro",
	})

	tests := []struct {
		name      string
		presented string
		want      apiToken
		found     bool
	}{
		{
			name: "hashed token", presented: testAPIToken, found: true,
			want: apiToken{name: "bot", digest: sha256.Sum256([]byte(testAPIToken))},
		},
		{
			name: "plain token", presented: testReadToken, found: true,
			want: apiToken{name: "reader", digest: sha256.Sum256([]byte(testReadToken)), readOnly: true, plain: true},
		},
		{name: "unknown token", presented: "scrawl_nope"},
		{name: "empty token", presented: ""},
		{name: "the configured digest is not a token", presented: TokenDigest(testAPIToken)},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			tok, found := svc.checkToken(tc.presented)

			// assert
			assert.Equal(t, tc.found, found)
			assert.Equal(t, tc.want, tok)
		})
	}
}

func TestServiceCheckTokenWithoutTokens(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{})

	// act
	tok, found := svc.checkToken(testAPIToken)

	// assert
	assert.False(t, found)
	assert.Equal(t, apiToken{}, tok)
}

func TestServiceCheckTokenAcceptsAnUppercaseDigest(t *testing.T) {
	// arrange
	digest := digestPrefix + strings.ToUpper(strings.TrimPrefix(TokenDigest(testAPIToken), digestPrefix))
	svc := newTestService(t, Config{Tokens: "bot:" + digest})

	// act
	tok, found := svc.checkToken(testAPIToken)

	// assert
	require.True(t, found)
	assert.Equal(t, apiToken{name: "bot", digest: sha256.Sum256([]byte(testAPIToken))}, tok)
}

func TestGenerateToken(t *testing.T) {
	// act
	token, other := GenerateToken(), GenerateToken()

	// assert
	assert.NotEqual(t, token, other)
	raw, err := b64.DecodeString(strings.TrimPrefix(token, tokenPrefix))
	require.NoError(t, err)
	assert.Len(t, raw, tokenBytes)
	assert.True(t, strings.HasPrefix(token, tokenPrefix), "a secret scanner keys on the prefix")
}

func TestGeneratedTokenVerifiesAgainstItsDigest(t *testing.T) {
	// arrange
	token := GenerateToken()
	svc := newTestService(t, Config{Tokens: "bot:" + TokenDigest(token)})

	// act
	tok, found := svc.checkToken(token)
	other, foundOther := svc.checkToken(GenerateToken())

	// assert
	require.True(t, found)
	assert.Equal(t, "bot", tok.name)
	assert.False(t, foundOther)
	assert.Equal(t, apiToken{}, other)
}

func TestBearerToken(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
		bearer bool
	}{
		{name: "bearer", header: "Bearer " + testAPIToken, want: testAPIToken, bearer: true},
		{name: "scheme is case-insensitive", header: "bEaReR " + testAPIToken, want: testAPIToken, bearer: true},
		{name: "surrounding whitespace is trimmed", header: " Bearer   " + testAPIToken + " ", want: testAPIToken, bearer: true},
		{name: "a tab separates the credential too", header: "Bearer\t" + testAPIToken, want: testAPIToken, bearer: true},
		{name: "empty credential", header: "Bearer ", bearer: true},
		{name: "scheme without a credential", header: "Bearer", bearer: true},
		{name: "scheme followed by a tab alone", header: "Bearer\t", bearer: true},
		{name: "no header"},
		{name: "another scheme", header: "Basic YWxpY2U6cGFzcw=="},
		{name: "a scheme the name is a prefix of", header: "Bearerish " + testAPIToken},
		{name: "the token alone", header: testAPIToken},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := httptest.NewRequest(http.MethodGet, "/api/tree", http.NoBody)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}

			// act
			got, bearer := bearerToken(req)

			// assert
			assert.Equal(t, tc.bearer, bearer)
			assert.Equal(t, tc.want, got)
		})
	}
}
