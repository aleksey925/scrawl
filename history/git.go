package history

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	defaultOutputCap = 8 << 20  // enough for a long log, small enough to bound a response
	maxBlobBytes     = 64 << 20 // a version of an upload, which the store caps far below this
	maxDiffBytes     = 2 << 20
	maxListBytes     = 32 << 20 // the whole index of a large corpus
	maxStderrBytes   = 8 << 10
)

var errOutputCap = errors.New("output cap reached")

// command is one git invocation. Everything it does not set falls back to the
// service defaults.
type command struct {
	args    []string
	stdin   []byte
	limit   int64         // max bytes of stdout, 0 means defaultOutputCap
	timeout time.Duration // 0 means Config.Timeout
}

// run executes git and returns its stdout. Every call is bounded by a timeout
// and an output cap, because both the repository and the notes in it may be
// larger or slower than anything the caller expects.
func (s *Service) run(ctx context.Context, c command) ([]byte, error) {
	timeout, limit := c.timeout, c.limit
	if timeout <= 0 {
		timeout = s.timeout()
	}
	if limit <= 0 {
		limit = defaultOutputCap
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	//nolint:gosec // the binary is what LookPath resolved and every argument is built in this package
	cmd := exec.CommandContext(ctx, s.git, append(s.baseArgs(), c.args...)...)
	cmd.Dir = s.root
	cmd.Env = s.env()
	if len(c.stdin) > 0 {
		cmd.Stdin = bytes.NewReader(c.stdin)
	}
	out := &capWriter{limit: limit, hard: true}
	stderr := &capWriter{limit: maxStderrBytes}
	cmd.Stdout, cmd.Stderr = out, stderr

	err := cmd.Run()
	switch {
	case out.exceeded:
		return nil, fmt.Errorf("git %s: more than %d bytes of output", c.args[0], limit)
	case err != nil:
		return nil, &gitError{args: c.args, stderr: strings.TrimSpace(stderr.buf.String()), err: err}
	}
	return out.buf.Bytes(), nil
}

// baseArgs are the options every call carries. They are top-level git options
// and have to come before the subcommand; git rejects them after it.
func (s *Service) baseArgs() []string {
	return []string{
		"--no-pager",
		// a path is a path: no pathspec magic, so a note named ":x.md" or
		// "-x.md" is staged and logged like any other
		"--literal-pathspecs",
		// only protected configuration is trusted for this, which the command
		// line is; the exact root, never "*", so no other repository is opened
		"-c", "safe.directory=" + s.root,
		// the notes directory may already be a repository somebody configured,
		// and --no-verify does not disable every hook
		// a place that can hold no hooks at all, rather than an empty directory
		// of ours inside the adopted repository: whoever assembled that
		// repository can leave a directory or a symlink standing there first
		"-c", "core.hooksPath=/dev/null",
		// another command the repository config gets to name, run on the
		// ordinary operations this package performs
		"-c", "core.fsmonitor=",
		"-c", "commit.gpgSign=false",
		"-c", "core.autocrlf=false",
		"-c", "core.quotePath=false",
		"-c", "user.name=" + committerName,
		"-c", "user.email=" + committerEmail,
	}
}

// env strips every GIT_* variable the host set - GIT_DIR, GIT_WORK_TREE,
// GIT_INDEX_FILE and the author and committer overrides would each redirect a
// commit somewhere we never looked - and pins the rest.
func (s *Service) env() []string {
	host := os.Environ()
	res := make([]string, 0, len(host)+5)
	for _, kv := range host {
		if strings.HasPrefix(kv, "GIT_") {
			continue
		}
		res = append(res, kv)
	}
	return append(res,
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_TERMINAL_PROMPT=0",
		"LC_ALL=C",
	)
}

// hasHead reports whether the repository has a commit. An empty one has no
// HEAD at all and every reader has to answer without asking git.
func (s *Service) hasHead(ctx context.Context) bool {
	_, err := s.run(ctx, command{args: []string{"rev-parse", "--verify", "-q", "HEAD"}})
	return err == nil
}

// staged reports whether the index holds anything to commit. Deciding this
// first means a nonzero exit from git commit is always a real failure.
func (s *Service) staged(ctx context.Context, timeout time.Duration) (bool, error) {
	_, err := s.run(ctx, command{args: []string{"diff", "--cached", "--quiet"}, timeout: timeout})
	if err == nil {
		return false, nil
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 {
		return true, nil
	}
	return false, err
}

// gitError carries what git said, which is the only useful part of a failure.
type gitError struct {
	args   []string
	stderr string
	err    error
}

// Error implements the error interface.
func (e *gitError) Error() string {
	if e.stderr == "" {
		return fmt.Sprintf("git %s: %v", strings.Join(e.args, " "), e.err)
	}
	return fmt.Sprintf("git %s: %v: %s", strings.Join(e.args, " "), e.err, e.stderr)
}

// Unwrap exposes the *exec.ExitError, so an exit code can be read off.
func (e *gitError) Unwrap() error { return e.err }

// isNotRepo reports the one failure of rev-parse that means "there is nothing
// here yet" rather than "something is wrong". The message is matched because
// git has no distinct exit code for it; LC_ALL=C keeps it in English.
func isNotRepo(err error) bool {
	var gitErr *gitError
	return errors.As(err, &gitErr) && strings.Contains(gitErr.stderr, "not a git repository")
}

// capWriter collects output up to a limit. A hard one fails the call when the
// limit is passed, a soft one keeps the head and drops the rest, which is what
// an error message needs.
type capWriter struct {
	buf      bytes.Buffer
	limit    int64
	hard     bool
	exceeded bool
}

// Write implements io.Writer.
func (w *capWriter) Write(p []byte) (int, error) {
	room := w.limit - int64(w.buf.Len())
	if int64(len(p)) <= room {
		return w.buf.Write(p)
	}
	w.exceeded = true
	if w.hard {
		return 0, errOutputCap
	}
	if room > 0 {
		w.buf.Write(p[:room])
	}
	return len(p), nil
}
