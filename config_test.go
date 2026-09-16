package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfigFromFlags(t *testing.T) {
	// arrange
	opts := &options{Root: "/notes", Project: "notes", ReadOnly: true}

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []projectConfig{{Name: "notes", Dir: "/notes", ReadOnly: true}}, cfgs)
}

func TestLoadConfigFromFile(t *testing.T) {
	// arrange
	opts := &options{Config: writeConfig(t, `
projects:
  - name: notes
    dir: /notes

  - name: team
    label: Team wiki
    dir: /data/team
    read_only: true
    exclude: ["drafts/*"]
    repo:
      url: https://github.com/acme/wiki.git
      branch: main
      pull: 5m
`)}

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []projectConfig{
		{Name: "notes", Dir: "/notes"},
		{
			Name: "team", Label: "Team wiki", Dir: "/data/team", ReadOnly: true,
			Exclude: []string{"drafts/*"},
			Remote: &remoteConfig{
				URL: "https://github.com/acme/wiki.git", Branch: "main", Pull: 5 * time.Minute,
			},
		},
	}, cfgs)
}

func TestLoadConfigRefuses(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		errText string
	}{
		{
			name:    "a misspelled key",
			body:    "projects:\n  - name: notes\n    directory: /notes\n",
			errText: "field directory not found",
		},
		{
			name: "both credential sources",
			body: "projects:\n  - name: notes\n    dir: /notes\n    repo:\n      url: https://x/y.git\n" +
				"      token_file: /run/t\n      token_env: T\n",
			errText: "sets both repo.token_file and repo.token_env",
		},
		{
			name: "a named variable with nothing in it",
			body: "projects:\n  - name: notes\n    dir: /notes\n    repo:\n      url: https://x/y.git\n" +
				"      token_env: SCRAWL_TEST_MISSING\n",
			errText: "names no value",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, err := loadConfig(&options{Config: writeConfig(t, tc.body)})

			// assert
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.errText)
		})
	}
}

func TestLoadConfigMissingFile(t *testing.T) {
	// act
	_, err := loadConfig(&options{Config: filepath.Join(t.TempDir(), "nope.yml")})

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read the config file")
}

// TestResolveToken is the whole credential story: a file and a variable resolve
// to the same value, and everything downstream - the redaction list, the header
// injection - never learns which one it came from.
func TestResolveToken(t *testing.T) {
	const token = "Bearer ghp_xxx"

	tests := []struct {
		name string
		// exactly one of the two is set, which is what the caller enforces
		file string
		env  string
		want string
	}{
		{name: "from a file", file: token, want: token},
		{name: "from a variable", env: token, want: token},
		{name: "a trailing newline off a file", file: token + "\n", want: token},
		{name: "a trailing crlf off a file", file: token + "\r\n", want: token},
		{name: "a trailing newline off a variable", env: token + "\n", want: token},
		{name: "neither source", want: ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			path, name := "", ""
			switch {
			case tc.file != "":
				path = filepath.Join(t.TempDir(), "token")
				require.NoError(t, os.WriteFile(path, []byte(tc.file), 0o600))
			case tc.env != "":
				name = "SCRAWL_TEST_TOKEN"
				t.Setenv(name, tc.env)
			}

			// act
			res, err := resolveToken(path, name)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, res)
		})
	}
}

// TestResolveTokenClearsTheVariable covers the reason it is read once: env()
// inherits os.Environ() for every git call, so a token left in place would
// ride along on git log and git status too.
func TestResolveTokenClearsTheVariable(t *testing.T) {
	// arrange
	t.Setenv("SCRAWL_TEST_TOKEN", "Bearer ghp_xxx")

	// act
	token, err := resolveToken("", "SCRAWL_TEST_TOKEN")

	// assert
	require.NoError(t, err)
	assert.Equal(t, "Bearer ghp_xxx", token)
	_, still := os.LookupEnv("SCRAWL_TEST_TOKEN")
	assert.False(t, still, "the variable must not be inherited by the git children")
}

func TestResolveTokenRefuses(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		errText string
	}{
		{name: "an embedded carriage return", raw: "Bearer a\rb", errText: "control character"},
		{name: "an embedded newline", raw: "Bearer a\nb", errText: "control character"},
		{name: "a tab", raw: "Bearer a\tb", errText: "control character"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			file := filepath.Join(t.TempDir(), "token")
			require.NoError(t, os.WriteFile(file, []byte(tc.raw), 0o600))

			// act
			_, err := resolveToken(file, "")

			// assert
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.errText)
		})
	}
}

func TestFlagProjectsReadTheFixedVariable(t *testing.T) {
	// arrange
	t.Setenv(repoTokenEnv, "Bearer ghp_flag")
	opts := &options{Root: "/notes", Project: "notes"}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"
	opts.Repo.Pull = time.Minute

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []projectConfig{{
		Name: "notes", Dir: "/notes",
		Remote: &remoteConfig{
			URL: "https://github.com/acme/wiki.git", Branch: "main",
			Token: "Bearer ghp_flag", Pull: time.Minute,
		},
	}}, cfgs)
}

// the fixed variable is optional, unlike one the configuration named: an https
// remote with no credential is the public-repository case
func TestFlagProjectsWithoutTheFixedVariable(t *testing.T) {
	// arrange
	opts := &options{Root: "/notes", Project: "notes"}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	require.NotNil(t, cfgs[0].Remote)
	assert.Empty(t, cfgs[0].Remote.Token)
}

func TestValidateRemote(t *testing.T) {
	tests := []struct {
		name    string
		remote  remoteConfig
		errText string
	}{
		{name: "https and a branch", remote: remoteConfig{URL: "https://x/y.git", Branch: "main"}},
		{name: "ssh", remote: remoteConfig{URL: "git@github.com:acme/wiki.git", Branch: "main"}},
		{name: "no url", remote: remoteConfig{Branch: "main"}, errText: "no url"},
		{name: "no branch", remote: remoteConfig{URL: "https://x/y.git"}, errText: "no branch"},
		{
			name:    "credentials in the url",
			remote:  remoteConfig{URL: "https://bob:pass@x/y.git", Branch: "main"},
			errText: "carries credentials",
		},
		{
			name:    "a branch git will not read",
			remote:  remoteConfig{URL: "https://x/y.git", Branch: "--upload-pack=touch"},
			errText: "as a branch name",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			cfg := projectConfig{Name: "notes", Dir: "/notes", Remote: &tc.remote}

			// act
			err := validateRemote(t.Context(), cfg)

			// assert
			if tc.errText != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.errText)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestProjectKind(t *testing.T) {
	// act & assert
	assert.Equal(t, "local", projectConfig{}.kind())
	assert.Equal(t, "remote", projectConfig{Remote: &remoteConfig{}}.kind())
}

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "scrawl.yml")
	require.NoError(t, os.WriteFile(p, []byte(body), 0o600))
	return p
}
