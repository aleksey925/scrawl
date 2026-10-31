package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

const repoTokenEnv = "REPO_TOKEN"

const repoHookSecretEnv = "REPO_HOOK_SECRET" //nolint:gosec // G101: the name of a variable, never a value

type configFile struct {
	Spaces []configSpace `yaml:"spaces"`
}

type configSpace struct {
	Name     string      `yaml:"name"`
	Label    string      `yaml:"label"`
	Dir      string      `yaml:"dir"`
	ReadOnly bool        `yaml:"read_only"`
	Exclude  []string    `yaml:"exclude"`
	Repo     *configRepo `yaml:"repo"`

	FormatOnSave *bool `yaml:"format_on_save"`
}

type configRepo struct {
	URL            string        `yaml:"url"`
	Branch         string        `yaml:"branch"`
	TokenFile      string        `yaml:"token_file"`
	TokenEnv       string        `yaml:"token_env"`
	Pull           *yamlDuration `yaml:"pull"`
	HookSecretFile string        `yaml:"hook_secret_file"`
	HookSecretEnv  string        `yaml:"hook_secret_env"`
}

type yamlDuration time.Duration

func (d *yamlDuration) UnmarshalYAML(node *yaml.Node) error {
	if node.Value == "0" {
		*d = 0
		return nil
	}
	parsed, err := time.ParseDuration(node.Value)
	if err != nil {
		return fmt.Errorf("read %q as an interval, try 30s or 5m: %w", node.Value, err)
	}
	*d = yamlDuration(parsed)
	return nil
}

func loadConfig(opts *options) ([]spaceConfig, error) {
	if opts.SpacesFile == "" {
		return flagSpaces(opts)
	}
	raw, err := os.ReadFile(opts.SpacesFile)
	if err != nil {
		return nil, fmt.Errorf("read the spaces file: %w", err)
	}

	var doc configFile
	dec := yaml.NewDecoder(strings.NewReader(string(raw)))
	dec.KnownFields(true)
	if err = dec.Decode(&doc); err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse %s: %w", opts.SpacesFile, err)
	}

	res := make([]spaceConfig, 0, len(doc.Spaces))
	for _, spc := range doc.Spaces {
		cfg := spaceConfig{
			Name:     spc.Name,
			Label:    spc.Label,
			Dir:      spc.Dir,
			ReadOnly: spc.ReadOnly,
			Exclude:  spc.Exclude,

			FormatOnSave: spc.FormatOnSave == nil || *spc.FormatOnSave,
		}
		if cfg.Remote, err = repoOf(spc); err != nil {
			return nil, err
		}
		res = append(res, cfg)
	}
	return res, nil
}

func repoOf(spc configSpace) (*remoteConfig, error) {
	if spc.Repo == nil {
		return nil, nil
	}
	if spc.Repo.TokenFile != "" && spc.Repo.TokenEnv != "" {
		return nil, fmt.Errorf("space %q sets both repo.token_file and repo.token_env, pick one", spc.Name)
	}
	if spc.Repo.HookSecretFile != "" && spc.Repo.HookSecretEnv != "" {
		return nil, fmt.Errorf("space %q sets both repo.hook_secret_file and repo.hook_secret_env, pick one",
			spc.Name)
	}
	token, err := resolveGitToken(spc.Repo.TokenFile, spc.Repo.TokenEnv)
	if err != nil {
		return nil, fmt.Errorf("space %q: %w", spc.Name, err)
	}
	hook, err := resolveHookSecret(spc.Repo.HookSecretFile, spc.Repo.HookSecretEnv)
	if err != nil {
		return nil, fmt.Errorf("space %q: %w", spc.Name, err)
	}
	branch := spc.Repo.Branch
	if branch == "" {
		branch = defaultRepoBranch
	}
	pull := defaultRepoPull
	if spc.Repo.Pull != nil {
		pull = time.Duration(*spc.Repo.Pull)
	}
	return &remoteConfig{
		URL:            spc.Repo.URL,
		Branch:         branch,
		Token:          token,
		Pull:           pull,
		HookSecret:     hook,
		HookSecretFile: spc.Repo.HookSecretFile,
	}, nil
}

func flagSpaces(opts *options) ([]spaceConfig, error) {
	cfg := spaceConfig{
		Name:     opts.Space.Name,
		Dir:      opts.Space.Dir,
		ReadOnly: opts.ReadOnly,

		FormatOnSave: opts.Space.FormatOnSave != formatOff,
	}
	if opts.Repo.URL == "" {
		return []spaceConfig{cfg}, nil
	}

	token, err := resolveGitToken("", namedIfSet(repoTokenEnv))
	if err != nil {
		return nil, err
	}
	hook, err := resolveHookSecret("", namedIfPresent(repoHookSecretEnv))
	if err != nil {
		return nil, err
	}
	cfg.Remote = &remoteConfig{
		URL:        opts.Repo.URL,
		Branch:     opts.Repo.Branch,
		Token:      token,
		Pull:       opts.Repo.Pull,
		HookSecret: hook,
	}
	return []spaceConfig{cfg}, nil
}

func namedIfSet(name string) string {
	if value, ok := os.LookupEnv(name); ok && value != "" {
		return name
	}
	return ""
}

func namedIfPresent(name string) string {
	if _, ok := os.LookupEnv(name); ok {
		return name
	}
	return ""
}

const tokenUser = "x-access-token"

var authSchemes = []string{"basic", "bearer", "token"}

func resolveGitToken(file, envVar string) (string, error) {
	raw, err := resolveSecret(gitCredential, file, envVar)
	if err != nil || raw == "" {
		return "", err
	}
	scheme, rest, named := strings.Cut(raw, " ")
	if !named {
		return "Basic " + base64.StdEncoding.EncodeToString([]byte(tokenUser+":"+raw)), nil
	}
	if !slices.Contains(authSchemes, strings.ToLower(scheme)) {
		return "", fmt.Errorf("the %s holds a space and does not start with %s, "+
			"pass the token on its own or a whole Authorization header",
			gitCredential, strings.Join(authSchemes, ", "))
	}
	if strings.EqualFold(scheme, "basic") {
		if _, err = base64.StdEncoding.DecodeString(rest); err != nil {
			return "", fmt.Errorf("the %s says Basic and what follows is not base64; "+
				"a bare token needs no scheme, or encode it with: "+
				`printf '%s:<token>' | base64`, gitCredential, tokenUser)
		}
	}
	return raw, nil
}

const minHookSecret = 32

func resolveHookSecret(file, envVar string) (string, error) {
	res, err := resolveSecret(hookSecret, file, envVar)
	if err != nil {
		return "", err
	}
	if file == "" && envVar == "" {
		return "", nil
	}
	if len(res) < minHookSecret {
		return "", fmt.Errorf("the %s is shorter than %d bytes, generate one with: openssl rand -hex 32",
			hookSecret, minHookSecret)
	}
	return res, nil
}

const (
	gitCredential = "repository credential"
	hookSecret    = "webhook secret"
)

func resolveSecret(what, file, envVar string) (string, error) {
	var raw string
	switch {
	case file != "":
		data, err := os.ReadFile(file) //nolint:gosec // the path is configuration, which is as trusted as the flags
		if err != nil {
			return "", fmt.Errorf("read the %s: %w", what, err)
		}
		raw = string(data)
	case envVar != "":
		value, ok := os.LookupEnv(envVar)
		if !ok || value == "" {
			return "", fmt.Errorf("%s names no value, set it or drop the %s it was named for", envVar, what)
		}
		raw = value
		if err := os.Unsetenv(envVar); err != nil {
			return "", fmt.Errorf("clear %s: %w", envVar, err)
		}
	default:
		return "", nil
	}
	return cleanToken(what, raw)
}

func cleanToken(what, raw string) (string, error) {
	res := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
	for _, r := range res {
		if r < ' ' || r == 0x7f {
			return "", fmt.Errorf("the %s holds a control character", what)
		}
	}
	return res, nil
}
