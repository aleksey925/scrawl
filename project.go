package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

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

// projectsOf reads the projects out of the options. Today that is the single
// project the flags name; a configuration file declares any number of them.
func projectsOf(opts *options) []projectConfig {
	return []projectConfig{{
		Name:     opts.Project,
		Dir:      opts.Root,
		ReadOnly: opts.ReadOnly,
	}}
}

// validateProjects checks everything answerable from the configuration text
// alone. None of it needs a project directory to exist, so a typo fails before
// a directory is created or a repository cloned.
func validateProjects(cfgs []projectConfig) error {
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
		Kind:     server.KindLocal,
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
