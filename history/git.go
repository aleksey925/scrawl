package history

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
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
	network bool          // talks to the remote, so the credential header applies
}

// gitRun is one git invocation with nothing left implicit. It exists because
// Clone happens when there is no directory and therefore no service, so it
// cannot take the working directory and the environment off one; every other
// call goes through the same function so that the hardening has one home.
type gitRun struct {
	git     string
	dir     string
	env     []string
	base    []string // top-level options, before the subcommand
	args    []string
	stdin   []byte
	limit   int64
	timeout time.Duration
	secret  string // redacted out of any failure this call reports
}

// runGit executes git and returns its stdout. Every call is bounded by a
// timeout and an output cap, because both the repository and the notes in it
// may be larger or slower than anything the caller expects.
func runGit(ctx context.Context, r gitRun) ([]byte, error) {
	if r.timeout <= 0 {
		r.timeout = defaultTimeout
	}
	if r.limit <= 0 {
		r.limit = defaultOutputCap
	}
	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()

	//nolint:gosec // the binary is what LookPath resolved and every argument is built in this package
	cmd := exec.CommandContext(ctx, r.git, append(r.base, r.args...)...)
	cmd.Dir = r.dir
	cmd.Env = r.env
	if len(r.stdin) > 0 {
		cmd.Stdin = bytes.NewReader(r.stdin)
	}
	out := &capWriter{limit: r.limit, hard: true}
	stderr := &capWriter{limit: maxStderrBytes}
	cmd.Stdout, cmd.Stderr = out, stderr

	err := cmd.Run()
	switch {
	case out.exceeded:
		return nil, fmt.Errorf("git %s: more than %d bytes of output", r.args[0], r.limit)
	case err != nil:
		return nil, &gitError{
			args:   r.args,
			stderr: strings.TrimSpace(stderr.buf.String()),
			err:    err,
			secret: r.secret,
		}
	}
	return out.buf.Bytes(), nil
}

// run executes git in this service's repository.
func (s *Service) run(ctx context.Context, c command) ([]byte, error) {
	timeout := c.timeout
	if timeout <= 0 {
		timeout = s.timeout()
	}
	return runGit(ctx, gitRun{
		git:     s.git,
		dir:     s.root,
		env:     s.env(c.network),
		base:    s.baseArgs(),
		args:    c.args,
		stdin:   c.stdin,
		limit:   c.limit,
		timeout: timeout,
		secret:  s.token(),
	})
}

// baseArgs are the options every call carries. They are top-level git options
// and have to come before the subcommand; git rejects them after it.
func (s *Service) baseArgs() []string {
	return hardenedArgs(s.root)
}

// hardenedArgs are the options every git call carries, whether a service is
// behind it or not.
func hardenedArgs(root string) []string {
	return []string{
		"--no-pager",
		// a path is a path: no pathspec magic, so a note named ":x.md" or
		// "-x.md" is staged and logged like any other
		"--literal-pathspecs",
		// only protected configuration is trusted for this, which the command
		// line is; the exact root, never "*", so no other repository is opened
		"-c", "safe.directory=" + root,
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

// env is the child environment of one call. withToken carries the credential
// header, and only the three commands that talk to a remote ask for it.
func (s *Service) env(withToken bool) []string {
	token := ""
	if withToken {
		token = s.token()
	}
	return gitEnv(token)
}

// gitEnv strips every GIT_* variable the host set - GIT_DIR, GIT_WORK_TREE,
// GIT_INDEX_FILE and the author and committer overrides would each redirect a
// commit somewhere we never looked - and pins the rest.
//
// A credential goes in here rather than on the command line: -c
// http.extraHeader=... would put the token in /proc/<pid>/cmdline, which is
// world readable, and in any gitError that quoted the arguments. /proc/<pid>/
// environ is readable only by the owning uid.
func gitEnv(token string) []string {
	host := os.Environ()
	res := make([]string, 0, len(host)+8)
	for _, kv := range host {
		if strings.HasPrefix(kv, "GIT_") {
			continue
		}
		res = append(res, kv)
	}
	res = append(res,
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_TERMINAL_PROMPT=0",
		"LC_ALL=C",
	)
	if token == "" {
		return res
	}
	return append(res,
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=http.extraHeader",
		"GIT_CONFIG_VALUE_0=Authorization: "+token,
	)
}

// token is the resolved credential header value, empty for a local project.
func (s *Service) token() string {
	if s.cfg.Remote == nil {
		return ""
	}
	return s.cfg.Remote.Token
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
	secret string // the credential of this call, never printed
}

// redacted stands in for anything that must not reach a log or a UI.
const redacted = "***"

// Error implements the error interface. The redaction is here rather than in a
// log filter, so it holds wherever the error is printed or returned - SyncError
// puts this text on a page, which lgr.Secret never touches.
func (e *gitError) Error() string {
	res := fmt.Sprintf("git %s: %v", strings.Join(redactArgs(e.args), " "), e.err)
	if e.stderr != "" {
		res += ": " + e.stderr
	}
	if e.secret != "" {
		res = strings.ReplaceAll(res, e.secret, redacted)
	}
	return res
}

// credentialArg matches an argument that carries a secret. Nothing in this
// package builds one, which is the point: a future call that does is redacted
// before anybody notices it was not.
var credentialArg = regexp.MustCompile(`(?i)(authorization|token|password|extraheader)=\S+|://[^/\s@]+:[^/\s@]+@`)

func redactArgs(args []string) []string {
	res := make([]string, len(args))
	for i, arg := range args {
		res[i] = credentialArg.ReplaceAllString(arg, redacted)
	}
	return res
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
