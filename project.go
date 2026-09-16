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

// projectName is what a name may look like. It is a URL slug and nothing else:
// the name is a path segment of every URL the deployment serves, so a space or
// an uppercase letter in it would be escaped differently by every client that
// builds one.
var projectName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// projectConfig is one project as the configuration names it, before anything
// on disk has been touched. Dir is always present: both consumers of a project
// directory take an explicit root and derive nothing, so the configuration says
// the same thing they do.
type projectConfig struct {
	Name     string
	Label    string
	Dir      string
	ReadOnly bool
	Exclude  []string
	// Remote says the directory is a managed clone. It is metadata on top of
	// Dir and never an alternative to it: both consumers take an explicit root,
	// and the operator has to see which volume must survive a restart.
	Remote *remoteConfig
}

// remoteConfig is a project's git remote, with the credential already resolved
// to the value git will be handed. Where it came from - a file, a named
// variable, REPO_TOKEN - stops in this package.
type remoteConfig struct {
	URL    string
	Branch string
	Token  string
	Pull   time.Duration
}

// kind names where a project's notes come from, which is all /api/projects says
// about it.
func (cfg projectConfig) kind() string {
	if cfg.Remote != nil {
		return server.KindRemote
	}
	return server.KindLocal
}

// runtimeProject is one project as main holds it: the concrete services it has
// to close, watch and reconcile, around the server's view of the same thing.
type runtimeProject struct {
	web   *server.Project
	notes *store.Store
	hist  *history.Service
	index *search.Index
}

// close releases what the project opened, in the reverse order it was opened.
func (rp *runtimeProject) close() {
	if rp.hist != nil {
		_ = rp.hist.Close()
	}
	if rp.notes != nil {
		_ = rp.notes.Close()
	}
}

// validateProjects checks everything answerable from the configuration text
// alone. None of it needs a project directory to exist, so a typo fails before
// a directory is created or a repository cloned.
func validateProjects(ctx context.Context, cfgs []projectConfig) error {
	if len(cfgs) == 0 {
		return errors.New("no project configured")
	}

	seen := make(map[string]struct{}, len(cfgs))
	for _, cfg := range cfgs {
		switch {
		case cfg.Name == "":
			return errors.New("every project needs a name, pass --project or set PROJECT")
		case !projectName.MatchString(cfg.Name):
			return fmt.Errorf("project name %q must be a url slug: lowercase letters, digits, - and _", cfg.Name)
		case cfg.Dir == "":
			return fmt.Errorf("project %q has no directory", cfg.Name)
		}
		if _, dup := seen[cfg.Name]; dup {
			return fmt.Errorf("two projects are named %q", cfg.Name)
		}
		seen[cfg.Name] = struct{}{}
		if err := validateRemote(ctx, cfg); err != nil {
			return err
		}
	}
	// lexically, because nothing has been created yet: a remote whose directory
	// sits inside another project's root would otherwise be cloned first and
	// the configuration rejected afterwards, leaving a clone somebody has to
	// find and delete by hand
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

// validateRemote checks a repo block before anything is cloned.
func validateRemote(ctx context.Context, cfg projectConfig) error {
	rm := cfg.Remote
	if rm == nil {
		return nil
	}
	if rm.URL == "" {
		return fmt.Errorf("project %q has a repo block with no url", cfg.Name)
	}
	// git clone writes the url into .git/config, so an inline password would be
	// persisted in plain text inside the notes volume and printed by every
	// later remote get-url check
	if parsed, err := url.Parse(rm.URL); err == nil && parsed.User != nil {
		return fmt.Errorf("the url of project %q carries credentials, name them with token_file or token_env instead",
			cfg.Name)
	}
	if rm.Branch == "" {
		return fmt.Errorf("project %q has a repo block with no branch", cfg.Name)
	}
	// the branch is interpolated into origin/<branch> and HEAD:refs/heads/
	// <branch>, so a name git would read as something else has to be refused
	// before the first fetch rather than after it
	if err := checkBranchName(ctx, rm.Branch); err != nil {
		return fmt.Errorf("the branch of project %q: %w", cfg.Name, err)
	}
	return nil
}

// checkBranchName asks git itself, because the rules are git's.
func checkBranchName(ctx context.Context, branch string) error {
	git, err := exec.LookPath("git")
	if err != nil {
		// without git there is no remote mode at all, and history says so in
		// its own words when the project is opened
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

// branchCheckTimeout bounds the one git call startup validation makes.
const branchCheckTimeout = 5 * time.Second

// resolveRoots turns each configured directory into the canonical path the
// store and history will use, and repeats the overlap check on those. Only the
// canonical comparison catches two symlink spellings of one directory, and it
// can only run once the directories are there.
func resolveRoots(cfgs []projectConfig) ([]string, error) {
	res := make([]string, len(cfgs))
	for i, cfg := range cfgs {
		root, err := filepath.Abs(cfg.Dir)
		if err != nil {
			return nil, fmt.Errorf("absolute path for the directory of %q: %w", cfg.Name, err)
		}
		fi, err := os.Stat(root)
		if err != nil {
			return nil, fmt.Errorf("directory %q of project %q: %w", root, cfg.Name, err)
		}
		if !fi.IsDir() {
			return nil, fmt.Errorf("%q of project %q is not a directory", root, cfg.Name)
		}
		if res[i], err = canonical(root); err != nil {
			return nil, fmt.Errorf("project %q: %w", cfg.Name, err)
		}
	}
	if err := overlapping(cfgs, res); err != nil {
		return nil, err
	}
	return res, nil
}

// overlapping refuses two roots where one holds the other. Two overlapping
// roots mean two watchers, two indexes and two repositories over the same
// files, which history would refuse on its own with ErrInsideRepo.
func overlapping(cfgs []projectConfig, paths []string) error {
	for i := range paths {
		for j := i + 1; j < len(paths); j++ {
			if contains(paths[i], paths[j]) || contains(paths[j], paths[i]) {
				return fmt.Errorf("projects %q and %q would serve the same files: %s and %s overlap",
					cfgs[i].Name, cfgs[j].Name, paths[i], paths[j])
			}
		}
	}
	return nil
}

// contains reports whether outer is inner or holds it.
func contains(outer, inner string) bool {
	return outer == inner || strings.HasPrefix(inner, outer+string(filepath.Separator))
}

// canonical resolves symlinks the way history does, so two spellings of one
// directory compare equal.
func canonical(p string) (string, error) {
	res, err := filepath.EvalSymlinks(p)
	if err != nil {
		return "", fmt.Errorf("resolve %q: %w", p, err)
	}
	return res, nil
}

// newProject opens everything one project needs, in the order the design fixes:
// the store first, then history, then the baseline reconcile, then the index.
// Watching comes after, from run, because a watcher takes its baseline snapshot
// when it starts and anything the worktree did before that produces no event.
func newProject(ctx context.Context, opts *options, cfg projectConfig, root string) (*runtimeProject, error) {
	notes, err := store.New(store.Config{
		Root:     root,
		Exclude:  slices.Concat(opts.Exclude, cfg.Exclude),
		ReadOnly: opts.ReadOnly || cfg.ReadOnly,
		Watch:    store.WatchMode(opts.Watch),
		Rescan:   opts.Rescan,
	})
	if err != nil {
		return nil, fmt.Errorf("open the notes directory of %q: %w", cfg.Name, err)
	}
	rp := &runtimeProject{notes: notes}
	warnUnwritable(cfg.Name, notes)

	//nolint:contextcheck // history.New bounds its own git calls with the init timeout, it takes no context
	if rp.hist, err = newHistory(opts, cfg, notes); err != nil {
		rp.close()
		return nil, err
	}
	// before the first request: this is the baseline import of a directory
	// history never saw, and the recovery for a crash between a write and its
	// commit, and both have to be in place before anything can be restored
	reconcile(ctx, cfg.Name, rp.hist, historyActorStartup)

	rp.index = search.New()
	if err = indexAll(cfg.Name, notes, rp.index); err != nil {
		rp.close()
		return nil, err
	}

	rp.web = &server.Project{
		Name:     cfg.Name,
		Label:    cfg.Label,
		Kind:     cfg.kind(),
		ReadOnly: cfg.ReadOnly,
		Store:    notes,
		Index:    rp.index,
		History:  rp.hist,
	}
	rp.web.Renderer = render.New(render.Options{
		LinkExists: notes.Exists,
		PagePrefix: rp.web.Prefix() + "/doc/",
		RawPrefix:  rp.web.Prefix() + "/raw/",
	})
	return rp, nil
}

// checkSecretFile refuses a signing key stored inside any of the notes
// directories: it would show up in the tree, in the search index and in every
// backup of the corpus, and anybody holding it can forge a session cookie.
//
// The file itself usually does not exist yet, auth creates it on first start,
// so the parent directory is what gets resolved and the base name is joined
// back on. Without that a key reached through a symlink would compare unequal
// to a canonical root and pass.
func checkSecretFile(roots []string, opts *options) error {
	if opts.Auth.Disabled || opts.Auth.SecretFile == "" {
		return nil
	}

	secret, err := filepath.Abs(opts.Auth.SecretFile)
	if err != nil {
		return fmt.Errorf("absolute path for secret file %q: %w", opts.Auth.SecretFile, err)
	}
	if dir, dErr := canonical(filepath.Dir(secret)); dErr == nil {
		secret = filepath.Join(dir, filepath.Base(secret))
	}
	for _, root := range roots {
		if contains(root, secret) {
			return fmt.Errorf("secret file %q must live outside the notes root %q", opts.Auth.SecretFile, root)
		}
	}
	return nil
}

// warnUnwritable names the failure a NAS deployment hits first: the container
// runs as a uid that does not own the mounted folder, reading works and every
// save comes back as an error. One line at startup beats finding out later.
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
