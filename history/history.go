// Package history keeps the notes directory under git, so that every write the
// app makes is recorded with the actor behind it and an old version can be
// read back. It shells out to the git binary; there is no library and no
// server-side state beyond the repository itself.
//
// The repository has to be rooted exactly at the notes directory. A directory
// that merely sits inside another repository is refused, never used: committing
// there would record whatever else that repository holds and sign it with a
// notes actor.
//
// Only the paths an operation names are ever staged. Ignore rules cannot
// express what the app treats as visible - git will not descend into an
// excluded directory, and a .gitignore among the notes themselves outranks
// anything scrawl could write - so the paths to version are handed to git
// explicitly on every call and the worktree as a whole is never staged. That
// also keeps a surrounding repository from absorbing unrelated edits.
//
// The notes directory may already carry a repository somebody else configured,
// so every call runs with a sanitized environment, no hooks, no pager, no diff
// drivers and no signing.
//
// A nil *Service is a working disabled service: Enabled reports false, Record
// runs the mutation and records nothing, and the readers report ErrDisabled.
// The caller that turns history off does not need a second code path.
package history

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultTimeout     = 10 * time.Second
	defaultInitTimeout = 5 * time.Minute
	defaultLogLimit    = 100

	initialBranch = "main"

	// committer of every commit; the actor is the author instead, so one
	// identity marks the machine and the other marks who asked for the change.
	committerName  = "scrawl"
	committerEmail = "scrawl@scrawl.local"

	actorDomain   = "scrawl.local"
	fallbackActor = "unknown"
)

// defaultExtensions are the files worth versioning: documents plus whatever an
// upload may leave behind. Video and archives are deliberately absent.
var defaultExtensions = []string{".md", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf"}

var (
	// ErrDisabled is returned by the readers of a nil service.
	ErrDisabled = errors.New("history is disabled")
	// ErrNoGit is returned by New when there is no git binary to run.
	ErrNoGit = errors.New("no git binary")
	// ErrInsideRepo is returned by New when the notes root is not a repository
	// root of its own but sits inside somebody else's repository.
	ErrInsideRepo = errors.New("the notes root is inside another repository")
	// ErrBadPath is returned for a path that is not a store path: absolute,
	// empty, escaping the root or carrying a NUL.
	ErrBadPath = errors.New("bad path")
)

// Config holds everything the service needs. Root and Files are mandatory.
type Config struct {
	Root        string                   // notes directory, the repository root
	Extensions  []string                 // versioned extensions, empty means defaultExtensions
	Files       func() ([]string, error) // every visible file, relative slash paths
	Timeout     time.Duration            // per git call, 0 means 10s
	InitTimeout time.Duration            // for Reconcile and the baseline import, 0 means 5m
}

// Service records changes to the notes directory in git. The zero value is not
// usable, call New. A nil *Service is a disabled one.
type Service struct {
	cfg   Config
	root  string // canonical absolute path of the notes root
	git   string // resolved git binary
	hooks string // empty directory used as core.hooksPath
	exts  map[string]struct{}
	files *os.Root // for existence checks, so a path cannot escape the root

	// mu covers a whole record: the caller's mutation, the staging and the
	// commit. Without it a second request's commit picks up the first
	// request's write and signs it with the wrong actor.
	mu       sync.Mutex
	pending  map[string]struct{} // paths whose commit failed, folded into the next one
	degraded atomic.Bool
}

// New prepares the repository for the notes root and returns the service. It
// initializes a repository when there is none, adopts one already rooted at the
// notes root, and refuses a root that lies inside another repository with
// ErrInsideRepo. It does not import anything: the caller runs Reconcile for
// that, which is also what recovers after a crash.
func New(cfg Config) (*Service, error) {
	if cfg.Root == "" {
		return nil, errors.New("history: root is required")
	}
	if cfg.Files == nil {
		return nil, errors.New("history: the file list is required")
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return nil, fmt.Errorf("history: %w: %w", ErrNoGit, err)
	}
	root, err := canonical(cfg.Root)
	if err != nil {
		return nil, fmt.Errorf("history: %w", err)
	}
	files, err := os.OpenRoot(root)
	if err != nil {
		return nil, fmt.Errorf("history: open %s: %w", root, err)
	}

	s := &Service{
		cfg:     cfg,
		root:    root,
		git:     gitPath,
		exts:    extensionSet(cfg.Extensions),
		files:   files,
		pending: map[string]struct{}{},
	}
	// core.hooksPath has to point somewhere that holds no hooks. Inside the
	// git directory it belongs to us and survives for the life of the repo.
	s.hooks = filepath.Join(root, ".git", "scrawl-no-hooks")

	ctx, cancel := context.WithTimeout(context.Background(), s.initTimeout())
	defer cancel()
	if err = s.open(ctx); err != nil {
		_ = files.Close()
		return nil, fmt.Errorf("history: %w", err)
	}
	if err = os.MkdirAll(s.hooks, 0o750); err != nil {
		log.Printf("[DEBUG] history: no hooks directory at %s, git will find no hooks there anyway: %v", s.hooks, err)
	}
	return s, nil
}

// Close releases the root handle. The repository itself needs no shutdown.
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	return s.files.Close()
}

// Enabled reports whether changes are recorded at all.
func (s *Service) Enabled() bool { return s != nil }

// Degraded reports that a commit failed and the notes on disk are ahead of what
// history holds. The next successful commit folds the missed paths in and
// clears it.
func (s *Service) Degraded() bool { return s != nil && s.degraded.Load() }

// Root returns the canonical path of the repository.
func (s *Service) Root() string {
	if s == nil {
		return ""
	}
	return s.root
}

// open adopts or creates the repository for the root.
func (s *Service) open(ctx context.Context) error {
	out, err := s.run(ctx, command{args: []string{"rev-parse", "--show-toplevel"}})
	switch {
	case err == nil:
		top, cErr := canonical(string(bytes.TrimRight(out, "\n")))
		if cErr != nil {
			return cErr
		}
		if top != s.root {
			return fmt.Errorf("%w at %s", ErrInsideRepo, top)
		}
	case isNotRepo(err):
		init := command{args: []string{"init", "--quiet", "--initial-branch=" + initialBranch}, timeout: s.initTimeout()}
		if _, iErr := s.run(ctx, init); iErr != nil {
			return fmt.Errorf("initialize a repository in %s: %w", s.root, iErr)
		}
		log.Printf("[INFO] history: initialized a git repository in %s", s.root)
	default:
		return err
	}
	return s.checkGitDir(ctx)
}

// checkGitDir refuses an administrative directory that is not the root's own.
// A .git gitfile - what a linked worktree leaves behind - resolves elsewhere,
// and committing through it would write into a repository we never inspected.
func (s *Service) checkGitDir(ctx context.Context) error {
	out, err := s.run(ctx, command{args: []string{"rev-parse", "--absolute-git-dir"}})
	if err != nil {
		return err
	}
	dir, err := canonical(string(bytes.TrimRight(out, "\n")))
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(s.root, dir)
	if err != nil {
		return fmt.Errorf("locate the git directory of %s: %w", s.root, err)
	}
	if rel != ".git" {
		return fmt.Errorf("the git directory of %s is %s, not its own .git", s.root, dir)
	}
	return nil
}

func (s *Service) timeout() time.Duration {
	if s.cfg.Timeout <= 0 {
		return defaultTimeout
	}
	return s.cfg.Timeout
}

func (s *Service) initTimeout() time.Duration {
	if s.cfg.InitTimeout <= 0 {
		return defaultInitTimeout
	}
	return s.cfg.InitTimeout
}

// versioned reports whether a path is one of the extensions we keep history for.
func (s *Service) versioned(p string) bool {
	_, ok := s.exts[strings.ToLower(path.Ext(p))]
	return ok
}

// exists reports whether a path is still on disk. It goes through os.Root, so a
// path that escapes the notes root, or reaches it through a symlink, is simply
// not there.
func (s *Service) exists(p string) bool {
	_, err := s.files.Stat(p)
	return err == nil
}

func extensionSet(exts []string) map[string]struct{} {
	if len(exts) == 0 {
		exts = defaultExtensions
	}
	res := make(map[string]struct{}, len(exts))
	for _, ext := range exts {
		cleaned := strings.ToLower(strings.TrimSpace(ext))
		if cleaned == "" {
			continue
		}
		if !strings.HasPrefix(cleaned, ".") {
			cleaned = "." + cleaned
		}
		res[cleaned] = struct{}{}
	}
	return res
}

// canonical resolves a path the way git reports one, so that two spellings of
// the same directory compare equal.
func canonical(p string) (string, error) {
	abs, err := filepath.Abs(strings.TrimSpace(p))
	if err != nil {
		return "", fmt.Errorf("resolve %q: %w", p, err)
	}
	res, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("resolve %q: %w", p, err)
	}
	return res, nil
}

// cleanPath turns a store path into one safe to hand to git: relative to the
// root, slash-separated and with nothing that could reach outside. A NUL is
// refused because the path lists are NUL-delimited on git's stdin.
func cleanPath(p string) (string, error) {
	if p == "" || strings.ContainsRune(p, 0) {
		return "", fmt.Errorf("%w: %q", ErrBadPath, p)
	}
	cleaned := path.Clean(p)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return "", fmt.Errorf("%w: %q", ErrBadPath, p)
	}
	if first, _, _ := strings.Cut(cleaned, "/"); first == ".git" {
		return "", fmt.Errorf("%w: %q is the git directory", ErrBadPath, p)
	}
	return cleaned, nil
}

// ident builds the author of a commit. The actor reaches this from the request,
// so anything that could break out of the "Name <email>" form is dropped.
func ident(actor string) string {
	name := sanitizeActor(actor)
	return name + " <" + actorEmail(name) + ">"
}

func sanitizeActor(actor string) string {
	res := strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '<' || r == '>' || r < ' ' {
			return -1
		}
		return r
	}, actor))
	if res == "" {
		return fallbackActor
	}
	return res
}

// actorEmail keeps the actor readable in the address too. Non-ASCII is left
// alone, git records it verbatim; only what would end the address is replaced.
func actorEmail(name string) string {
	local := strings.Trim(strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '<' || r == '>' || r == '@' || r < ' ' {
			return '-'
		}
		return r
	}, name), "-")
	if local == "" {
		local = fallbackActor
	}
	return local + "@" + actorDomain
}
