package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

// repoTokenEnv is the one variable the flag path reads a credential from. It is
// a fixed name because with a single project there is nothing to disambiguate,
// and it is optional: an https remote with no credential is a public repository,
// which is a supported deployment.
const repoTokenEnv = "REPO_TOKEN"

// repoHookSecretEnv is the hook secret of the flag path, the same fixed and
// optional shape REPO_TOKEN has.
const repoHookSecretEnv = "REPO_HOOK_SECRET" //nolint:gosec // G101: the name of a variable, never a value

// configFile is the document --config names.
type configFile struct {
	Projects []configProject `yaml:"projects"`
}

// configProject is one project as the file declares it. Every project names its
// own directory, and repo is optional metadata saying that directory is a clone
// somebody else owns rather than a folder of ours.
type configProject struct {
	Name     string      `yaml:"name"`
	Label    string      `yaml:"label"`
	Dir      string      `yaml:"dir"`
	ReadOnly bool        `yaml:"read_only"`
	Exclude  []string    `yaml:"exclude"`
	Repo     *configRepo `yaml:"repo"`
}

// configRepo points a project at a git remote. The credential is always named
// and never written down here: token_file names a file, token_env a variable,
// and setting both is an error rather than a precedence rule an operator has to
// remember at the worst possible moment.
type configRepo struct {
	URL       string       `yaml:"url"`
	Branch    string       `yaml:"branch"`
	TokenFile string       `yaml:"token_file"`
	TokenEnv  string       `yaml:"token_env"`
	Pull      yamlDuration `yaml:"pull"`
	// the shared secret the upstream repository signs its deliveries with,
	// named exactly the way the git credential is and read by the same helper
	HookSecretFile string `yaml:"hook_secret_file"`
	HookSecretEnv  string `yaml:"hook_secret_env"`
}

// yamlDuration reads an interval the way a human writes one, "5m". It exists
// for the one value yaml's own duration handling refuses: a bare 0, which is
// how a project says it wants no ticker at all.
type yamlDuration time.Duration

// UnmarshalYAML implements the yaml unmarshaler.
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

// loadConfig reads the projects a run serves. Without --config that is the
// single project the flags name; with it, the file replaces them and the flags
// stay the global defaults.
//
// It runs before setupLog, because the credentials it resolves have to be in
// the redaction list before anything can print one.
func loadConfig(opts *options) ([]projectConfig, error) {
	if opts.Config == "" {
		return flagProjects(opts)
	}
	raw, err := os.ReadFile(opts.Config)
	if err != nil {
		return nil, fmt.Errorf("read the config file: %w", err)
	}

	var doc configFile
	dec := yaml.NewDecoder(strings.NewReader(string(raw)))
	// a misspelled key is a startup error and not a setting that silently did
	// nothing, which is the whole reason a config file is worth having
	dec.KnownFields(true)
	if err = dec.Decode(&doc); err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse %s: %w", opts.Config, err)
	}

	res := make([]projectConfig, 0, len(doc.Projects))
	for _, prj := range doc.Projects {
		cfg := projectConfig{
			Name:     prj.Name,
			Label:    prj.Label,
			Dir:      prj.Dir,
			ReadOnly: prj.ReadOnly,
			Exclude:  prj.Exclude,
		}
		if cfg.Remote, err = repoOf(prj); err != nil {
			return nil, err
		}
		res = append(res, cfg)
	}
	return res, nil
}

// repoOf resolves one project's repo block, credentials and all.
func repoOf(prj configProject) (*remoteConfig, error) {
	if prj.Repo == nil {
		return nil, nil
	}
	if prj.Repo.TokenFile != "" && prj.Repo.TokenEnv != "" {
		return nil, fmt.Errorf("project %q sets both repo.token_file and repo.token_env, pick one", prj.Name)
	}
	if prj.Repo.HookSecretFile != "" && prj.Repo.HookSecretEnv != "" {
		return nil, fmt.Errorf("project %q sets both repo.hook_secret_file and repo.hook_secret_env, pick one",
			prj.Name)
	}
	token, err := resolveSecret(gitCredential, prj.Repo.TokenFile, prj.Repo.TokenEnv)
	if err != nil {
		return nil, fmt.Errorf("project %q: %w", prj.Name, err)
	}
	hook, err := resolveHookSecret(prj.Repo.HookSecretFile, prj.Repo.HookSecretEnv)
	if err != nil {
		return nil, fmt.Errorf("project %q: %w", prj.Name, err)
	}
	return &remoteConfig{
		URL:            prj.Repo.URL,
		Branch:         prj.Repo.Branch,
		Token:          token,
		Pull:           time.Duration(prj.Repo.Pull),
		HookSecret:     hook,
		HookSecretFile: prj.Repo.HookSecretFile,
	}, nil
}

// flagProjects builds the single project of the flag path. It produces the same
// shape the file does, so nothing downstream learns which way a project was
// declared.
func flagProjects(opts *options) ([]projectConfig, error) {
	cfg := projectConfig{
		Name:     opts.Project,
		Dir:      opts.Root,
		ReadOnly: opts.ReadOnly,
	}
	if opts.Repo.URL == "" {
		return []projectConfig{cfg}, nil
	}

	token, err := resolveSecret(gitCredential, "", namedIfSet(repoTokenEnv))
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
	return []projectConfig{cfg}, nil
}

// namedIfSet names a fixed variable only while it holds something. Naming an
// unset one is what makes a missing value an error, and nothing in the
// configuration named it: it is the flag path's own. An https remote with no
// credential is a public repository, so an empty one means "no credential"
// rather than a mistake.
func namedIfSet(name string) string {
	if value, ok := os.LookupEnv(name); ok && value != "" {
		return name
	}
	return ""
}

// namedIfPresent names a fixed variable that exists, whatever it holds. It is
// what the hook secret reads, because there the empty string is never a choice:
// an operator who put the variable in a compose file and got nothing into it
// has a broken secret, not a webhook they meant to turn off.
func namedIfPresent(name string) string {
	if _, ok := os.LookupEnv(name); ok {
		return name
	}
	return ""
}

// minHookSecret is the length of `openssl rand -hex 32` halved, which is what
// the README tells the operator to generate. It is not a format rule and not an
// entropy estimate: anything longer passes.
const minHookSecret = 32

// resolveHookSecret reads the secret the webhook is verified with, and refuses
// one too short to be worth verifying against. The rule lives here and never in
// resolveSecret, which has to keep returning the empty string for a public
// repository that needs no git credential at all.
//
// A source that was named and resolved to nothing is refused rather than read
// as "no webhook": an empty file and a file that failed to mount look the same
// from here, the endpoint is reachable without a session, and an empty key is
// one anybody can sign with. Turning the webhook off is done by naming no
// source, which is the one case that answers with no secret and no error.
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

// the two things a project names a secret for, used for nothing but the words
// an error is written in: one resolver serves both, and "the repository
// credential could not be read" is the wrong sentence for a webhook.
const (
	gitCredential = "repository credential"
	hookSecret    = "webhook secret"
)

// resolveSecret reads the secret a project named, from a file or from an
// environment variable, and returns the value itself. It is the only place
// either source is read: history rebuilds the child environment on every call
// and has to redact the identical value out of a failure message, so a second
// read could hand git a rotated secret that was never registered for redaction
// and the log would then print it in full.
//
// A variable that was named and is empty is an error: the operator wrote the
// name down, so a missing value is a typo or a missing -e, not a choice.
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
		// env() inherits os.Environ() for every git call, local ones included,
		// so a token left here would ride along on git log and git status for
		// the life of the process. It does nothing about the process manager
		// that set it, which keeps the value whatever we do.
		if err := os.Unsetenv(envVar); err != nil {
			return "", fmt.Errorf("clear %s: %w", envVar, err)
		}
	default:
		return "", nil
	}
	return cleanToken(what, raw)
}

// cleanToken strips the one trailing newline a secret file and a shell heredoc
// both leave behind, and refuses anything else that could split a header.
func cleanToken(what, raw string) (string, error) {
	res := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
	for _, r := range res {
		if r < ' ' || r == 0x7f {
			return "", fmt.Errorf("the %s holds a control character", what)
		}
	}
	return res, nil
}
