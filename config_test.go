package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfigFromFlags(t *testing.T) {
	// arrange
	opts := &options{Space: spaceOptions{Name: "notes", Dir: "/notes", FormatOnSave: formatOff}, ReadOnly: true}

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []spaceConfig{{Name: "notes", Dir: "/notes", ReadOnly: true}}, cfgs)
}

func TestLoadConfigFromFile(t *testing.T) {
	// arrange
	opts := &options{SpacesFile: writeConfig(t, `
spaces:
  - name: notes
    dir: /notes

  - name: team
    label: Team wiki
    dir: /data/team
    read_only: true
    format_on_save: false
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
	assert.Equal(t, []spaceConfig{
		{Name: "notes", Dir: "/notes", FormatOnSave: true},
		{
			Name: "team", Label: "Team wiki", Dir: "/data/team", ReadOnly: true,
			Exclude: []string{"drafts/*"},
			Remote: &remoteConfig{
				URL: "https://github.com/acme/wiki.git", Branch: "main", Pull: 5 * time.Minute,
			},
		},
	}, cfgs)
}

func TestLoadConfigRepoDefaults(t *testing.T) {
	tests := []struct {
		name string
		repo string
		want remoteConfig
	}{
		{
			name: "nothing but the url",
			repo: "",
			want: remoteConfig{URL: "https://x/y.git", Branch: defaultRepoBranch, Pull: defaultRepoPull},
		},
		{
			name: "a written zero turns the ticker off",
			repo: "      pull: 0\n",
			want: remoteConfig{URL: "https://x/y.git", Branch: defaultRepoBranch},
		},
		{
			name: "both written",
			repo: "      branch: trunk\n      pull: 1h\n",
			want: remoteConfig{URL: "https://x/y.git", Branch: "trunk", Pull: time.Hour},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{SpacesFile: writeConfig(t, "spaces:\n  - name: wiki\n    dir: /wiki\n"+
				"    repo:\n      url: https://x/y.git\n"+tc.repo)}

			// act
			cfgs, err := loadConfig(opts)

			// assert
			require.NoError(t, err)
			assert.Equal(t, []spaceConfig{{Name: "wiki", Dir: "/wiki", FormatOnSave: true, Remote: &tc.want}}, cfgs)
		})
	}
}

func TestIgnoredSpaceSettings(t *testing.T) {
	tests := []struct {
		name string
		args []string
		env  map[string]string
		want []string
	}{
		{name: "no spaces file", args: []string{"--space.name=notes", "--repo.url=https://x/y.git"}},
		{name: "a spaces file alone", args: []string{"--spaces-file=/etc/spaces.yml"}, want: []string{}},
		{
			name: "every setting of the single space",
			args: []string{
				"--spaces-file=/etc/spaces.yml", "--space.name=notes", "--space.dir=/data", "--space.format-on-save=off",
				"--repo.url=https://x/y.git", "--repo.branch=trunk", "--repo.pull=1h",
			},
			env: map[string]string{repoTokenEnv: "token", repoHookSecretEnv: "secret"},
			want: []string{
				"SPACE_NAME", "SPACE_DIR", "SPACE_FORMAT_ON_SAVE", "REPO_URL", "REPO_BRANCH", "REPO_PULL",
				repoTokenEnv, repoHookSecretEnv,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			for name, value := range tc.env {
				t.Setenv(name, value)
			}
			opts, err := parseOpts(tc.args)
			require.NoError(t, err)

			// act
			ignored := ignoredSpaceSettings(opts)

			// assert
			assert.Equal(t, tc.want, ignored)
		})
	}
}

func TestLoadConfigRefuses(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		errText string
	}{
		{
			name:    "a misspelled key",
			body:    "spaces:\n  - name: notes\n    directory: /notes\n",
			errText: "field directory not found",
		},
		{
			name: "both credential sources",
			body: "spaces:\n  - name: notes\n    dir: /notes\n    repo:\n      url: https://x/y.git\n" +
				"      token_file: /run/t\n      token_env: T\n",
			errText: "sets both repo.token_file and repo.token_env",
		},
		{
			name: "a named variable with nothing in it",
			body: "spaces:\n  - name: notes\n    dir: /notes\n    repo:\n      url: https://x/y.git\n" +
				"      token_env: SCRAWL_TEST_MISSING\n",
			errText: "names no value",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, err := loadConfig(&options{SpacesFile: writeConfig(t, tc.body)})

			// assert
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.errText)
		})
	}
}

func TestLoadConfigMissingFile(t *testing.T) {
	// act
	_, err := loadConfig(&options{SpacesFile: filepath.Join(t.TempDir(), "nope.yml")})

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read the spaces file")
}

// TestResolveSecret is the whole credential story: a file and a variable resolve
// to the same value, and everything downstream - the redaction list, the header
// injection - never learns which one it came from.
func TestResolveSecret(t *testing.T) {
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
			res, err := resolveSecret(gitCredential, path, name)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, res)
		})
	}
}

// TestResolveSecretClearsTheVariable covers the reason it is read once: env()
// inherits os.Environ() for every git call, so a token left in place would
// ride along on git log and git status too.
func TestResolveSecretClearsTheVariable(t *testing.T) {
	// arrange
	t.Setenv("SCRAWL_TEST_TOKEN", "Bearer ghp_xxx")

	// act
	token, err := resolveSecret(gitCredential, "", "SCRAWL_TEST_TOKEN")

	// assert
	require.NoError(t, err)
	assert.Equal(t, "Bearer ghp_xxx", token)
	_, still := os.LookupEnv("SCRAWL_TEST_TOKEN")
	assert.False(t, still, "the variable must not be inherited by the git children")
}

func TestResolveSecretRefuses(t *testing.T) {
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
			_, err := resolveSecret(gitCredential, file, "")

			// assert
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.errText)
		})
	}
}

func TestFlagSpacesReadTheFixedVariable(t *testing.T) {
	// arrange
	t.Setenv(repoTokenEnv, "Bearer ghp_flag")
	opts := &options{Space: spaceOptions{Name: "notes", Dir: "/notes"}}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"
	opts.Repo.Pull = time.Minute

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []spaceConfig{{
		Name: "notes", Dir: "/notes", FormatOnSave: true,
		Remote: &remoteConfig{
			URL: "https://github.com/acme/wiki.git", Branch: "main",
			Token: "Bearer ghp_flag", Pull: time.Minute,
		},
	}}, cfgs)
}

// TestResolveGitToken is what an operator actually holds: a token, not a
// header. A whole header still passes through, because the scheme a host wants
// is the host's business and Bitbucket takes only Bearer.
func TestResolveGitToken(t *testing.T) {
	const pat = "github_pat_xxx"
	encoded := base64.StdEncoding.EncodeToString([]byte(tokenUser + ":" + pat))

	tests := []struct {
		name    string
		raw     string
		want    string
		errText string
	}{
		{name: "a bare token", raw: pat, want: "Basic " + encoded},
		{name: "a whole basic header", raw: "Basic " + encoded, want: "Basic " + encoded},
		{name: "a whole bearer header", raw: "Bearer " + pat, want: "Bearer " + pat},
		{name: "a scheme in another case", raw: "basic " + encoded, want: "basic " + encoded},
		{name: "no credential at all", raw: "", want: ""},
		{
			name:    "a basic header holding the token itself",
			raw:     "Basic " + pat,
			errText: "not base64",
		},
		{
			name:    "something else with a space in it",
			raw:     "user pass",
			errText: "pass the token on its own",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			file := filepath.Join(t.TempDir(), "token")
			require.NoError(t, os.WriteFile(file, []byte(tc.raw), 0o600))
			if tc.raw == "" {
				file = ""
			}

			// act
			res, err := resolveGitToken(file, "")

			// assert
			if tc.errText != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.errText)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, res)
		})
	}
}

// the header the child git process ends up carrying, which is the only thing
// that has to be right: whatever the operator wrote, this is what GitHub reads
func TestABareTokenBecomesTheHeaderGitSends(t *testing.T) {
	// arrange
	t.Setenv(repoTokenEnv, "github_pat_xxx")
	opts := &options{Space: spaceOptions{Name: "notes", Dir: "/notes"}}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	assert.Equal(t, "Basic "+base64.StdEncoding.EncodeToString([]byte(tokenUser+":github_pat_xxx")),
		cfgs[0].Remote.Token)
}

// the fixed variable is optional, unlike one the configuration named: an https
// remote with no credential is the public-repository case
func TestFlagSpacesWithoutTheFixedVariable(t *testing.T) {
	// arrange
	opts := &options{Space: spaceOptions{Name: "notes", Dir: "/notes"}}
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
			cfg := spaceConfig{Name: "notes", Dir: "/notes", Remote: &tc.remote}

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

func TestSpaceKind(t *testing.T) {
	// act & assert
	assert.Equal(t, "local", spaceConfig{}.kind())
	assert.Equal(t, "remote", spaceConfig{Remote: &remoteConfig{}}.kind())
}

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "scrawl.yml")
	require.NoError(t, os.WriteFile(p, []byte(body), 0o600))
	return p
}
