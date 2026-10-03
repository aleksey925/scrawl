package auth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func TestParseUsers(t *testing.T) {
	tests := []struct {
		name  string
		spec  string
		users map[string]credential
		err   string
	}{
		{name: "empty input", spec: "", users: map[string]credential{}},
		{name: "only separators", spec: " , ; \n ", users: map[string]credential{}},
		{
			name: "plain password", spec: "alice:pass",
			users: map[string]credential{"alice": {plain: []byte("pass")}},
		},
		{
			name: "bcrypt hash", spec: "alice:" + testHash,
			users: map[string]credential{"alice": {hash: []byte(testHash)}},
		},
		{
			name: "password with colons", spec: "alice:pa:ss:word",
			users: map[string]credential{"alice": {plain: []byte("pa:ss:word")}},
		},
		{
			name: "comma separated", spec: "alice:one,bob:two",
			users: map[string]credential{"alice": {plain: []byte("one")}, "bob": {plain: []byte("two")}},
		},
		{
			name: "semicolon and newline separated", spec: "alice:one;bob:two\r\ncarol:three",
			users: map[string]credential{
				"alice": {plain: []byte("one")},
				"bob":   {plain: []byte("two")},
				"carol": {plain: []byte("three")},
			},
		},
		{
			name: "surrounding whitespace is trimmed", spec: "  alice : pass  ,\tbob:two ",
			users: map[string]credential{"alice": {plain: []byte("pass")}, "bob": {plain: []byte("two")}},
		},
		{
			name: "comments are skipped", spec: "# admins\nalice:pass\n#bob:two",
			users: map[string]credential{"alice": {plain: []byte("pass")}},
		},
		{
			name: "every bcrypt prefix", spec: "a:$2a$04$" + strings.Repeat("x", 53) +
				",b:$2b$04$" + strings.Repeat("x", 53) + ",c:$2y$04$" + strings.Repeat("x", 53),
			users: map[string]credential{
				"a": {hash: []byte("$2a$04$" + strings.Repeat("x", 53))},
				"b": {hash: []byte("$2b$04$" + strings.Repeat("x", 53))},
				"c": {hash: []byte("$2y$04$" + strings.Repeat("x", 53))},
			},
		},
		{name: "no colon", spec: "alice", err: `bad user entry "alice": want name:hashOrPassword`},
		{name: "empty name", spec: ":pass", err: `bad user entry ":pass": empty user name`},
		{name: "empty password", spec: "alice:", err: `user "alice": empty password`},
		{name: "empty password after trimming", spec: "alice:   ", err: `user "alice": empty password`},
		{name: "duplicate user", spec: "alice:one,alice:two", err: `user "alice" is configured twice`},
		{name: "broken hash", spec: "alice:$2a$04$tooshort", err: `user "alice": broken bcrypt hash`},
		{
			name: "compose mangled hash", spec: "alice:$$2a$$10$$" + strings.Repeat("x", 53),
			err: "docker-compose interpolation mangled it",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			users, err := parseUsers(tc.spec)
			if tc.err != "" {
				assert.Nil(t, users)
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.users, users)
		})
	}
}

func TestPlainUsers(t *testing.T) {
	// arrange
	users, err := parseUsers("carol:plain,alice:" + testHash + ",bob:plain")

	// act & assert
	require.NoError(t, err)
	assert.Equal(t, []string{"bob", "carol"}, plainUsers(users))
}

func TestServiceCheck(t *testing.T) {
	svc := newTestService(t, Config{Users: "alice:" + testHash + ",bob:plain:pass,carol:" + mustHash("other", bcrypt.MinCost)})

	tests := []struct {
		name     string
		user     string
		password string
		want     bool
	}{
		{name: "hashed user with the right password", user: "alice", password: testPassword, want: true},
		{name: "hashed user with a wrong password", user: "alice", password: "nope"},
		{name: "plain user with the right password", user: "bob", password: "plain:pass", want: true},
		{name: "plain user with a wrong password", user: "bob", password: "plain"},
		{name: "plain user with a prefix of the password", user: "bob", password: "plain:pas"},
		{name: "unknown user", user: "mallory", password: testPassword},
		{name: "empty user", user: "", password: testPassword},
		{name: "empty password", user: "alice", password: ""},
		{name: "another user's password", user: "carol", password: testPassword},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, svc.Check(tc.user, tc.password))
		})
	}
}

func TestServiceCheckEqualisesTiming(t *testing.T) {
	tests := []struct {
		name  string
		user  string
		dummy int
	}{
		{name: "unknown user burns a bcrypt comparison", user: "mallory", dummy: 1},
		{name: "plain user burns a bcrypt comparison", user: "bob", dummy: 1},
		{name: "hashed user compares its own hash", user: "alice"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			svc := newTestService(t, Config{Users: "alice:" + testHash + ",bob:plain"})
			generate := svc.dummy
			calls := 0
			svc.dummy = func() []byte {
				calls++
				return generate()
			}

			// act
			svc.Check(tc.user, "whatever")

			// assert
			assert.Equal(t, tc.dummy, calls)
		})
	}
}

func TestDummyHash(t *testing.T) {
	tests := []struct {
		name string
		spec string
		cost int
	}{
		{name: "no users at all", spec: "", cost: bcrypt.DefaultCost},
		{name: "plain users only", spec: "alice:pass", cost: bcrypt.DefaultCost},
		{name: "cheap hash does not lower the cost", spec: "alice:" + testHash, cost: bcrypt.DefaultCost},
		{name: "expensive hash raises the cost", spec: "alice:" + mustHash("x", 11), cost: 11},
		{
			name: "the highest cost in use wins",
			spec: "alice:" + testHash + ",bob:" + mustHash("x", 11) + ",carol:" + mustHash("x", 12),
			cost: 12,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			users, err := parseUsers(tc.spec)
			require.NoError(t, err)

			// act
			hash := dummyHash(users)()

			// assert
			cost, err := bcrypt.Cost(hash)
			require.NoError(t, err)
			assert.Equal(t, tc.cost, cost)
		})
	}
}

func TestHashPassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		err      string
	}{
		{name: "ordinary password", password: testPassword},
		{name: "password with a colon", password: "pa:ss"},
		{name: "at the bcrypt limit", password: strings.Repeat("x", maxPasswordLen)},
		{name: "empty", password: "", err: "password must not be empty"},
		{name: "past the bcrypt limit", password: strings.Repeat("x", maxPasswordLen+1), err: "bcrypt accepts at most 72"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			hash, err := HashPassword(tc.password)
			if tc.err != "" {
				assert.Empty(t, hash)
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.err)
				return
			}
			require.NoError(t, err)
			assert.True(t, isBcryptHash(hash))
			assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(hash), []byte(tc.password)))
		})
	}
}
