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
	// HookSecret turns the webhook on. It is not a git credential and history
	// never learns about it: the endpoint is the only thing that uses it.
	HookSecret string
	// HookSecretFile is kept only so the canonical phase can check where it
	// lives, the way it checks the session key.
	HookSecretFile string
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
	pull  time.Duration // background fetch interval, 0 for a local project
	// trigger carries a webhook delivery to the sync loop. Capacity one, and
	// never closed: a delivery arriving after shutdown is a dropped send and
	// not a panic.
	trigger chan struct{}
}

// notify asks the sync loop to run. It never blocks, because it is called from
// a request handler, and it never queues more than one run: twenty deliveries
// in a second ask the same question, and twenty goroutines would each take the
// history lock in turn and put every save behind the whole queue.
//
// One pending run is still kept, because a delivery that arrived while a Sync
// was already in flight has to cause another one: that fetch may have started
// before the push landed.
func (rp *runtimeProject) notify() {
	select {
	case rp.trigger <- struct{}{}:
	default:
	}
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
	// a hook secret on a project that is not a remote is impossible rather than
	// refused: the fields live inside the repo block, and a misspelled key is a
	// startup error. So there is no "the hook fired for a local folder" case to
	// answer anywhere below.
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
	// the endpoint is reachable without a session, and nothing rate limits it,
	// so an empty or short secret turns it into a public "resync this project"
	// button that can be guessed against the 202/401 answer. The shared
	// resolver may not grow this rule: a public https remote legitimately has
	// no git credential at all.
	if rm.HookSecret != "" && len(rm.HookSecret) < minHookSecret {
		return fmt.Errorf("the webhook secret of project %q is shorter than %d bytes, "+
			"generate one with: openssl rand -hex 32", cfg.Name, minHookSecret)
	}
	return nil
}

// minHookSecret is the length of `openssl rand -hex 32` halved, which is what
// the README tells the operator to generate. It is not a format rule and not an
// entropy estimate: anything longer passes.
const minHookSecret = 32

// logRemote names both refresh switches at startup, so the configuration of a
// remote project is readable in the log rather than inferred from its silence.
func logRemote(cfg projectConfig, rp *runtimeProject) {
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

// redactURL strips a userinfo a url may carry. Validation refuses one, so this
// covers a url that reached the log some other way.
func redactURL(raw string) string {
	at := strings.LastIndex(raw, "@")
	scheme := strings.Index(raw, "://")
	if at < 0 || scheme < 0 || at < scheme {
		return raw
	}
	return raw[:scheme+3] + "***" + raw[at:]
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

// ensureDirs makes every remote project's directory exist before the canonical
// phase, which cannot resolve a path that is not there. A local project's
// directory is never created: it is a volume the operator mounted, and one
// scrawl made up would be an empty corpus nobody noticed.
func ensureDirs(ctx context.Context, opts *options, cfgs []projectConfig) error {
	for _, cfg := range cfgs {
		if cfg.Remote == nil {
			continue
		}
		empty, err := emptyDir(cfg.Dir)
		if err != nil {
			return fmt.Errorf("project %q: %w", cfg.Name, err)
		}
		if !empty {
			continue
		}
		if err = history.Clone(ctx, cfg.Dir, remoteOf(opts, cfg)); err != nil {
			return fmt.Errorf("project %q: %w", cfg.Name, err)
		}
	}
	return nil
}

// emptyDir reports whether a path holds nothing worth keeping, which is what a
// first clone needs: missing, or there and empty.
func emptyDir(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return true, nil
	case err != nil:
		return false, fmt.Errorf("read %s: %w", dir, err)
	}
	return len(entries) == 0, nil
}

// remoteOf turns a project's configuration into what history takes. PullOnly is
// the effective read-only mode seen from the git side: a project that will
// never push has nothing to gain from trying and everything to lose from
// reporting itself unpublished for changes nobody made.
func remoteOf(opts *options, cfg projectConfig) history.Remote {
	return history.Remote{
		URL:       cfg.Remote.URL,
		Branch:    cfg.Remote.Branch,
		Token:     cfg.Remote.Token,
		PullEvery: cfg.Remote.Pull,
		PullOnly:  opts.ReadOnly || cfg.ReadOnly,
	}
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
// the store, history, the baseline reconcile, the first sync, then the index.
//
// The order is not an implementation detail. store.Watch installs its watches
// and takes its baseline snapshot before it returns, so a fast-forward merge
// that landed after it produces no event and the index would stay stale for the
// life of the process. Reconcile runs before the fetch because it only commits
// what is already on disk, which keeps a local change from being what the merge
// trips over. Watching itself comes last, from run.
func newProject(ctx context.Context, opts *options, cfg projectConfig, root string) (*runtimeProject, error) {
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
	rp := &runtimeProject{notes: notes, pull: pullEvery(cfg), trigger: make(chan struct{}, 1)}
	warnUnwritable(cfg.Name, notes)

	//nolint:contextcheck // history.New bounds its own git calls with the init timeout, it takes no context
	if rp.hist, err = newHistory(opts, cfg, notes); err != nil {
		rp.close()
		return nil, err
	}
	// before the first request: this is the baseline import of a directory
	// history never saw, and the recovery for a crash between a write and its
	// commit, and both have to be in place before anything can be restored.
	// A pull-only project is not reconciled at all: it has no push to carry the
	// commit anywhere, and committing would report it unpublished for changes
	// nobody made.
	if !readOnly || cfg.Remote == nil {
		reconcile(ctx, cfg.Name, rp.hist, historyActorStartup)
	}
	syncRemote(ctx, cfg.Name, rp.hist)
	probeWritable(ctx, cfg.Name, rp.hist)

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
	if cfg.Remote != nil && cfg.Remote.HookSecret != "" {
		rp.web.Webhook = &server.Webhook{Secret: cfg.Remote.HookSecret, Notify: rp.notify}
	}
	logRemote(cfg, rp)
	return rp, nil
}

// checkSecretFiles refuses a secret stored inside any of the notes
// directories: it would show up in the tree, in the search index and in every
// backup of the corpus, and rawHandler would serve it to anybody who can sign
// in. It covers the session signing key and every webhook secret, because the
// reason is the same for both.
//
// A file often does not exist yet - auth creates the session key on first
// start - so the parent directory is what gets resolved and the base name is
// joined back on. Without that a file reached through a symlinked parent would
// compare unequal to a canonical root and pass.
func checkSecretFiles(roots []string, opts *options, cfgs []projectConfig) error {
	named := map[string]string{}
	if !opts.Auth.Disabled && opts.Auth.SecretFile != "" {
		named[opts.Auth.SecretFile] = "session key"
	}
	for _, cfg := range cfgs {
		if cfg.Remote != nil && cfg.Remote.HookSecretFile != "" {
			named[cfg.Remote.HookSecretFile] = "webhook secret of project " + cfg.Name
		}
	}

	for file, what := range named {
		resolved, err := filepath.Abs(file)
		if err != nil {
			return fmt.Errorf("absolute path for the %s %q: %w", what, file, err)
		}
		if dir, dErr := canonical(filepath.Dir(resolved)); dErr == nil {
			resolved = filepath.Join(dir, filepath.Base(resolved))
		}
		for _, root := range roots {
			if contains(root, resolved) {
				return fmt.Errorf("the %s %q must live outside the notes root %q", what, file, root)
			}
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
