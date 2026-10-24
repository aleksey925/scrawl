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
	defaultOutputCap = 8 << 20
	maxBlobBytes     = 64 << 20
	maxDiffBytes     = 2 << 20
	maxListBytes     = 32 << 20
	maxStderrBytes   = 8 << 10
)

var (
	errOutputCap = errors.New("output cap reached")
	errExitOne   = errors.New("exit status 1")
)

type command struct {
	args    []string
	stdin   []byte
	limit   int64
	timeout time.Duration
	network bool
	exitOne bool
}

type gitRun struct {
	git     string
	dir     string
	env     []string
	base    []string
	args    []string
	stdin   []byte
	limit   int64
	timeout time.Duration
	exitOne bool
	secret  string
}

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
	case r.exitOne && exitCode(err) == 1:
		return out.buf.Bytes(), errExitOne
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
		exitOne: c.exitOne,
		secret:  s.token(),
	})
}

func exitCode(err error) int {
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	return -1
}

func (s *Service) baseArgs() []string {
	return hardenedArgs(s.root)
}

func hardenedArgs(root string) []string {
	return []string{
		"--no-pager",
		"--literal-pathspecs",
		"-c", "safe.directory=" + root,
		"-c", "core.hooksPath=/dev/null",
		"-c", "core.fsmonitor=",
		"-c", "commit.gpgSign=false",
		"-c", "core.autocrlf=false",
		"-c", "core.quotePath=false",
		"-c", "user.name=" + committerName,
		"-c", "user.email=" + committerEmail,
	}
}

func (s *Service) env(withToken bool) []string {
	token := ""
	if withToken {
		token = s.token()
	}
	return gitEnv(token)
}

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

func (s *Service) token() string {
	if s.cfg.Remote == nil {
		return ""
	}
	return s.cfg.Remote.Token
}

func (s *Service) hasHead(ctx context.Context) bool {
	_, err := s.run(ctx, command{args: []string{"rev-parse", "--verify", "-q", "HEAD"}})
	return err == nil
}

func (s *Service) staged(ctx context.Context, timeout time.Duration) (bool, error) {
	_, err := s.run(ctx, command{args: []string{"diff", "--cached", "--quiet"}, timeout: timeout, exitOne: true})
	switch {
	case err == nil:
		return false, nil
	case errors.Is(err, errExitOne):
		return true, nil
	}
	return false, err
}

type gitError struct {
	args   []string
	stderr string
	err    error
	secret string
}

const redacted = "***"

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

var credentialArg = regexp.MustCompile(`(?i)(authorization|token|password|extraheader)=\S+|://[^/\s@]+:[^/\s@]+@`)

func redactArgs(args []string) []string {
	res := make([]string, len(args))
	for i, arg := range args {
		res[i] = credentialArg.ReplaceAllString(arg, redacted)
	}
	return res
}

func (e *gitError) Unwrap() error { return e.err }

func isNotRepo(err error) bool {
	var gitErr *gitError
	return errors.As(err, &gitErr) && strings.Contains(gitErr.stderr, "not a git repository")
}

type capWriter struct {
	buf      bytes.Buffer
	limit    int64
	hard     bool
	exceeded bool
}

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
