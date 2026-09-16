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
	URL       string        `yaml:"url"`
	Branch    string        `yaml:"branch"`
	TokenFile string        `yaml:"token_file"`
	TokenEnv  string        `yaml:"token_env"`
	Pull      time.Duration `yaml:"pull"`
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
		if cfg.Remote, err = remoteOf(prj); err != nil {
			return nil, err
		}
		res = append(res, cfg)
	}
	return res, nil
}

// remoteOf resolves one project's repo block, credential and all.
func remoteOf(prj configProject) (*remoteConfig, error) {
	if prj.Repo == nil {
		return nil, nil
	}
	if prj.Repo.TokenFile != "" && prj.Repo.TokenEnv != "" {
		return nil, fmt.Errorf("project %q sets both repo.token_file and repo.token_env, pick one", prj.Name)
	}
	token, err := resolveToken(prj.Repo.TokenFile, prj.Repo.TokenEnv)
	if err != nil {
		return nil, fmt.Errorf("project %q: %w", prj.Name, err)
	}
	return &remoteConfig{
		URL:    prj.Repo.URL,
		Branch: prj.Repo.Branch,
		Token:  token,
		Pull:   prj.Repo.Pull,
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

	// the fixed variable is optional, so it is named only when it holds
	// something: naming an unset one is what makes a missing value an error,
	// and nothing in the configuration named this one
	source := ""
	if value, ok := os.LookupEnv(repoTokenEnv); ok && value != "" {
		source = repoTokenEnv
	}
	token, err := resolveToken("", source)
	if err != nil {
		return nil, err
	}
	cfg.Remote = &remoteConfig{
		URL:    opts.Repo.URL,
		Branch: opts.Repo.Branch,
		Token:  token,
		Pull:   opts.Repo.Pull,
	}
	return []projectConfig{cfg}, nil
}

// resolveToken reads the credential a project named, from a file or from an
// environment variable, and returns the header value itself. It is the only
// place either source is read: history rebuilds the child environment on every
// call and has to redact the identical value out of a failure message, so a
// second read could hand git a rotated secret that was never registered for
// redaction and the log would then print it in full.
//
// A variable that was named and is empty is an error: the operator wrote the
// name down, so a missing value is a typo or a missing -e, not a choice.
func resolveToken(file, envVar string) (string, error) {
	var raw string
	switch {
	case file != "":
		data, err := os.ReadFile(file) //nolint:gosec // the path is configuration, which is as trusted as the flags
		if err != nil {
			return "", fmt.Errorf("read the repository credential: %w", err)
		}
		raw = string(data)
	case envVar != "":
		value, ok := os.LookupEnv(envVar)
		if !ok || value == "" {
			return "", fmt.Errorf("%s names no value, set it or drop repo.token_env", envVar)
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
	return cleanToken(raw)
}

// cleanToken strips the one trailing newline a secret file and a shell heredoc
// both leave behind, and refuses anything else that could split a header.
func cleanToken(raw string) (string, error) {
	res := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
	for _, r := range res {
		if r < ' ' || r == 0x7f {
			return "", errors.New("the repository credential holds a control character")
		}
	}
	return res, nil
}
