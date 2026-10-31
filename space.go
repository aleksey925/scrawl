package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/server"
	"github.com/aleksey925/scrawl/store"
)

var spaceName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

type spaceConfig struct {
	Name     string
	Label    string
	Dir      string
	ReadOnly bool
	Exclude  []string

	FormatOnSave bool
	Remote       *remoteConfig
}

type remoteConfig struct {
	URL            string
	Branch         string
	Token          string
	Pull           time.Duration
	HookSecret     string
	HookSecretFile string
}

func (cfg spaceConfig) kind() string {
	if cfg.Remote != nil {
		return server.KindRemote
	}
	return server.KindLocal
}

type runtimeSpace struct {
	web     *server.Space
	notes   *store.Store
	hist    *history.Service
	index   *search.Index
	pull    time.Duration
	trigger chan struct{}
}

func (rp *runtimeSpace) notify() {
	select {
	case rp.trigger <- struct{}{}:
	default:
	}
}

func (rp *runtimeSpace) close() {
	if rp.hist != nil {
		_ = rp.hist.Close()
	}
	if rp.notes != nil {
		_ = rp.notes.Close()
	}
}

func validateSpaces(ctx context.Context, cfgs []spaceConfig) error {
	if len(cfgs) == 0 {
		return errors.New("no space configured")
	}

	seen := make(map[string]struct{}, len(cfgs))
	for _, cfg := range cfgs {
		switch {
		case cfg.Name == "":
			return errors.New("every space needs a name, pass --space.name or set SPACE_NAME")
		case !spaceName.MatchString(cfg.Name):
			return fmt.Errorf("space name %q must be a url slug: lowercase letters, digits, - and _", cfg.Name)
		case cfg.Dir == "":
			return fmt.Errorf("space %q has no directory", cfg.Name)
		}
		if _, dup := seen[cfg.Name]; dup {
			return fmt.Errorf("two spaces are named %q", cfg.Name)
		}
		seen[cfg.Name] = struct{}{}
		if err := validateRemote(ctx, cfg); err != nil {
			return err
		}
	}
	dirs := make([]string, len(cfgs))
	for i, cfg := range cfgs {
		abs, err := filepath.Abs(cfg.Dir)
		if err != nil {
			return fmt.Errorf("absolute path for the directory of %q: %w", cfg.Name, err)
		}
		dirs[i] = filepath.Clean(abs)
	}
	return overlapping(cfgs, dirs)
}

func validateRemote(ctx context.Context, cfg spaceConfig) error {
	rm := cfg.Remote
	if rm == nil {
		return nil
	}
	if rm.URL == "" {
		return fmt.Errorf("space %q has a repo block with no url", cfg.Name)
	}
	if parsed, err := url.Parse(rm.URL); err == nil && parsed.User != nil {
		return fmt.Errorf("the url of space %q carries credentials, name them with token_file or token_env instead",
			cfg.Name)
	}
	if rm.Branch == "" {
		return fmt.Errorf("space %q has a repo block with no branch", cfg.Name)
	}
	if err := checkBranchName(ctx, rm.Branch); err != nil {
		return fmt.Errorf("the branch of space %q: %w", cfg.Name, err)
	}
	return nil
}

func logRemote(cfg spaceConfig, rp *runtimeSpace) {
	if cfg.Remote == nil {
		return
	}
	pull := "off"
	if rp.pull > 0 {
		pull = rp.pull.String()
	}
	hook := "off"
	if rp.web.Webhook != nil {
		hook = "on"
	}
	log.Printf("[INFO] %s: remote %s, pull %s, webhook %s", cfg.Name, redactURL(cfg.Remote.URL), pull, hook)
}

func redactURL(raw string) string {
	at := strings.LastIndex(raw, "@")
	scheme := strings.Index(raw, "://")
	if at < 0 || scheme < 0 || at < scheme {
		return raw
	}
	return raw[:scheme+3] + "***" + raw[at:]
}

func checkBranchName(ctx context.Context, branch string) error {
	git, err := exec.LookPath("git")
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, branchCheckTimeout)
	defer cancel()
	//nolint:gosec // the binary is what LookPath resolved and the branch is configuration
	if err = exec.CommandContext(ctx, git, "check-ref-format", "--branch", branch).Run(); err != nil {
		return fmt.Errorf("git will not read %q as a branch name", branch)
	}
	return nil
}

const branchCheckTimeout = 5 * time.Second

func ensureDirs(ctx context.Context, opts *options, cfgs []spaceConfig) error {
	for _, cfg := range cfgs {
		if cfg.Remote == nil {
			continue
		}
		empty, err := emptyDir(cfg.Dir)
		if err != nil {
			return fmt.Errorf("space %q: %w", cfg.Name, err)
		}
		if !empty {
			continue
		}
		if err = history.Clone(ctx, cfg.Dir, remoteOf(opts, cfg)); err != nil {
			return fmt.Errorf("space %q: %w", cfg.Name, err)
		}
	}
	return nil
}

func emptyDir(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return true, nil
	case err != nil:
		return false, fmt.Errorf("read %s: %w", dir, err)
	}
	for _, ent := range entries {
		if ent.Name() == history.StagingDir {
			return true, nil
		}
	}
	return len(entries) == 0, nil
}

func remoteOf(opts *options, cfg spaceConfig) history.Remote {
	return history.Remote{
		URL:       cfg.Remote.URL,
		Branch:    cfg.Remote.Branch,
		Token:     cfg.Remote.Token,
		PullEvery: cfg.Remote.Pull,
		PullOnly:  opts.ReadOnly || cfg.ReadOnly,
	}
}

func resolveRoots(cfgs []spaceConfig) ([]string, error) {
	res := make([]string, len(cfgs))
	for i, cfg := range cfgs {
		root, err := filepath.Abs(cfg.Dir)
		if err != nil {
			return nil, fmt.Errorf("absolute path for the directory of %q: %w", cfg.Name, err)
		}
		fi, err := os.Stat(root)
		if err != nil {
			return nil, fmt.Errorf("directory %q of space %q: %w", root, cfg.Name, err)
		}
		if !fi.IsDir() {
			return nil, fmt.Errorf("%q of space %q is not a directory", root, cfg.Name)
		}
		if res[i], err = canonical(root); err != nil {
			return nil, fmt.Errorf("space %q: %w", cfg.Name, err)
		}
	}
	if err := overlapping(cfgs, res); err != nil {
		return nil, err
	}
	return res, nil
}

func overlapping(cfgs []spaceConfig, paths []string) error {
	for i := range paths {
		for j := i + 1; j < len(paths); j++ {
			if contains(paths[i], paths[j]) || contains(paths[j], paths[i]) {
				return fmt.Errorf("spaces %q and %q would serve the same files: %s and %s overlap",
					cfgs[i].Name, cfgs[j].Name, paths[i], paths[j])
			}
		}
	}
	return nil
}

func contains(outer, inner string) bool {
	return outer == inner || strings.HasPrefix(inner, outer+string(filepath.Separator))
}

func canonical(p string) (string, error) {
	res, err := filepath.EvalSymlinks(p)
	if err != nil {
		return "", fmt.Errorf("resolve %q: %w", p, err)
	}
	return res, nil
}

func newSpace(ctx context.Context, opts *options, cfg spaceConfig, root string) (*runtimeSpace, error) {
	readOnly := opts.ReadOnly || cfg.ReadOnly
	notes, err := store.New(store.Config{
		Root:     root,
		Exclude:  slices.Concat(opts.Exclude, cfg.Exclude),
		ReadOnly: readOnly,
		Watch:    store.WatchMode(opts.Watch),
		Rescan:   opts.Rescan,
	})
	if err != nil {
		return nil, fmt.Errorf("open the notes directory of %q: %w", cfg.Name, err)
	}
	rp := &runtimeSpace{notes: notes, pull: pullEvery(cfg), trigger: make(chan struct{}, 1)}
	warnUnwritable(cfg.Name, notes)

	//nolint:contextcheck // history.New bounds its own git calls with the init timeout, it takes no context
	if rp.hist, err = newHistory(opts, cfg, notes); err != nil {
		rp.close()
		return nil, err
	}
	reconcile(ctx, cfg.Name, rp.hist, historyActorStartup)
	syncRemote(ctx, cfg.Name, rp.hist)
	probeWritable(ctx, cfg.Name, rp.hist)

	rp.index = search.New()
	if err = indexAll(cfg.Name, notes, rp.index); err != nil {
		rp.close()
		return nil, err
	}

	rp.web = &server.Space{
		Name:     cfg.Name,
		Label:    cfg.Label,
		Kind:     cfg.kind(),
		ReadOnly: cfg.ReadOnly,
		Store:    notes,
		Index:    rp.index,
		History:  rp.hist,

		FormatOnSave: cfg.FormatOnSave,
	}
	rp.web.Renderer = render.New(render.Options{
		LinkExists: notes.Exists,
		PagePrefix: rp.web.Prefix() + "/doc/",
		RawPrefix:  rp.web.Prefix() + "/raw/",
	})
	if cfg.Remote != nil && cfg.Remote.HookSecret != "" {
		rp.web.Webhook = &server.Webhook{Secret: cfg.Remote.HookSecret, Notify: rp.notify}
	}
	logRemote(cfg, rp)
	return rp, nil
}

func checkSecretFiles(roots []string, opts *options, cfgs []spaceConfig) error {
	named := map[string]string{}
	if !opts.Auth.Disabled && opts.Auth.SecretFile != "" {
		named[opts.Auth.SecretFile] = "session key"
	}
	for _, cfg := range cfgs {
		if cfg.Remote != nil && cfg.Remote.HookSecretFile != "" {
			named[cfg.Remote.HookSecretFile] = "webhook secret of space " + cfg.Name
		}
	}

	for file, what := range named {
		resolved, err := resolvedPath(file)
		if err != nil {
			return fmt.Errorf("absolute path for the %s %q: %w", what, file, err)
		}
		for _, root := range roots {
			inside, rErr := resolvedPath(root)
			if rErr != nil {
				return fmt.Errorf("absolute path for the notes root %q: %w", root, rErr)
			}
			if contains(inside, resolved) {
				return fmt.Errorf("the %s %q must live outside the notes root %q", what, file, root)
			}
		}
	}
	return nil
}

func resolvedPath(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	missing := ""
	for at := abs; ; {
		if res, cErr := canonical(at); cErr == nil {
			return filepath.Join(res, missing), nil
		}
		parent := filepath.Dir(at)
		if parent == at {
			return abs, nil
		}
		missing = filepath.Join(filepath.Base(at), missing)
		at = parent
	}
}

func warnUnwritable(name string, notes *store.Store) {
	if notes.ReadOnly() {
		return
	}
	if err := notes.CheckWritable(); err != nil {
		log.Printf("[WARN] %s: %s is not writable by uid %d gid %d, every save will fail: %v",
			name, notes.Dir(), os.Getuid(), os.Getgid(), err)
		log.Printf("[WARN] set the container user to the owner of that folder (`id <user>` on the NAS gives the numbers), " +
			"or start with --read-only")
	}
}
