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

	committerName  = "scrawl"
	committerEmail = "scrawl@scrawl.local"

	actorDomain   = "scrawl.local"
	fallbackActor = "unknown"

	inertAttr = "* -filter merge"
)

var defaultExtensions = []string{".md", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf"}

var (
	ErrDisabled   = errors.New("history is disabled")
	ErrNoGit      = errors.New("no git binary")
	ErrInsideRepo = errors.New("the notes root is inside another repository")
	ErrBadPath    = errors.New("bad path")
	ErrNoVersion  = errors.New("no such version")
)

type Config struct {
	Name        string
	Root        string
	Extensions  []string
	Files       func() ([]string, error)
	Visible     func(string) bool
	Timeout     time.Duration
	InitTimeout time.Duration

	Remote   *Remote
	TrackAll bool
}

type Service struct {
	cfg   Config
	root  string
	git   string
	exts  map[string]struct{}
	files *os.Root

	mu       sync.Mutex
	pending  map[string]struct{}
	degraded atomic.Bool

	sync atomic.Pointer[SyncState]
}

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
	ctx, cancel := context.WithTimeout(context.Background(), s.initTimeout())
	defer cancel()
	if err = s.open(ctx); err != nil {
		_ = files.Close()
		return nil, fmt.Errorf("history: %w", err)
	}
	if err = s.disableFilters(); err != nil {
		_ = files.Close()
		return nil, fmt.Errorf("history: %w", err)
	}
	if cfg.Remote != nil {
		if err = s.checkRemote(ctx); err != nil {
			_ = files.Close()
			return nil, fmt.Errorf("history: %w", err)
		}
	}
	return s, nil
}

func (s *Service) ownPath(p string) error {
	fi, err := os.Lstat(p)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return nil
	case err != nil:
		return err
	case fi.Mode()&os.ModeSymlink == 0:
		return nil
	}
	if err = os.Remove(p); err != nil {
		return fmt.Errorf("remove the symlink at %s: %w", p, err)
	}
	log.Printf("[WARN] %s: removed %s, which was a symlink the repository carried", s.tag(), p)
	return nil
}

func (s *Service) tag() string {
	if s.cfg.Name == "" {
		return "history"
	}
	return "history " + s.cfg.Name
}

func (s *Service) disableFilters() error {
	dir := filepath.Join(s.root, ".git", "info")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("prepare %s: %w", dir, err)
	}

	name := filepath.Join(dir, "attributes")
	if err := s.ownPath(name); err != nil {
		return err
	}
	current, err := os.ReadFile(name) //nolint:gosec // a path inside the repository we just opened
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read %s: %w", name, err)
	}
	if lastAttrRule(current) == inertAttr {
		return nil
	}
	if len(current) > 0 && !bytes.HasSuffix(current, []byte("\n")) {
		current = append(current, '\n')
	}
	if err = os.WriteFile(name, append(current, []byte(inertAttr+"\n")...), 0o600); err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	return nil
}

func lastAttrRule(content []byte) string {
	res := ""
	for line := range strings.SplitSeq(string(content), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		res = trimmed
	}
	return res
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	return s.files.Close()
}

func (s *Service) Enabled() bool { return s != nil }

func (s *Service) Degraded() bool { return s != nil && s.degraded.Load() }

func (s *Service) Root() string {
	if s == nil {
		return ""
	}
	return s.root
}

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
		log.Printf("[INFO] %s: initialized a git repository in %s", s.tag(), s.root)
	default:
		return err
	}
	return s.checkGitDir(ctx)
}

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

func (s *Service) versioned(p string) bool {
	if s.cfg.TrackAll {
		return true
	}
	_, ok := s.exts[strings.ToLower(path.Ext(p))]
	return ok
}

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
