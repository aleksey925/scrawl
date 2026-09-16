package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/fatih/color"
	"github.com/go-pkgz/lgr"
	"github.com/jessevdk/go-flags"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/server"
	"github.com/aleksey925/scrawl/store"
)

// revision is set at build time with -ldflags "-X main.revision=..."
var revision = "0.0.0"

// defaultRoot is what --root carries when nobody set it, which is how a run
// tells an explicit root from one it was simply given.
const defaultRoot = "/notes"

type options struct {
	Root         string   `short:"r" long:"root" env:"ROOT" default:"/notes" description:"notes root directory"`
	Project      string   `long:"project" env:"PROJECT" description:"name of the single project, the URL segment it is served under"`
	Config       string   `long:"config" env:"CONFIG" description:"yaml file declaring several projects, replaces --root and --project"`
	Listen       string   `short:"l" long:"listen" env:"LISTEN" default:":7272" description:"address to listen on"`
	Title        string   `long:"title" env:"TITLE" default:"Notes" description:"site title"`
	ReadOnly     bool     `long:"read-only" env:"READ_ONLY" description:"disable all write endpoints"`
	Exclude      []string `long:"exclude" env:"EXCLUDE" env-delim:"," description:"extra ignore globs"`
	MaxUpload    byteSize `long:"max-upload" env:"MAX_UPLOAD" default:"20M" description:"upload size cap"`
	UploadDir    string   `long:"upload-dir" env:"UPLOAD_DIR" description:"put every upload in this one directory instead of a folder named after the document"`
	TrustedProxy bool     `long:"trusted-proxy" env:"TRUSTED_PROXY" description:"trust X-Forwarded-For and X-Forwarded-Proto"`

	Watch  string        `long:"watch" env:"WATCH" default:"auto" choice:"auto" choice:"poll" description:"change detection, poll for a network share"`
	Rescan time.Duration `long:"rescan" env:"RESCAN" default:"60s" description:"periodic full rescan, negative disables it unless watch is poll"`

	History string `long:"history" env:"HISTORY" default:"auto" choice:"auto" choice:"on" choice:"off" description:"document history in git"`

	// the single project's remote, mirroring the repo block of the config file
	// field for field. There is deliberately no --repo-token: a flag value
	// lands in /proc/<pid>/cmdline, which is world readable, so the credential
	// comes from REPO_TOKEN and from nowhere else.
	Repo struct {
		URL    string        `long:"url" env:"URL" description:"clone this git remote into --root and push what is edited back"`
		Branch string        `long:"branch" env:"BRANCH" default:"main" description:"branch to track"`
		Pull   time.Duration `long:"pull" env:"PULL" default:"5m" description:"how often to fetch, 0 disables the background pull"`
	} `group:"repo" namespace:"repo" env-namespace:"REPO"`

	Auth struct {
		Users      []string      `long:"users" env:"USERS" env-delim:"," description:"user:bcryptHashOrPlainPassword pairs"`
		Tokens     []string      `long:"tokens" env:"TOKENS" env-delim:"," description:"name:tokenHashOrPlain[:ro] entries for API clients"`
		Secret     string        `long:"secret" env:"SECRET" description:"cookie signing key, generated and persisted if empty"`
		SecretFile string        `long:"secret-file" env:"SECRET_FILE" default:"/data/session.key" description:"where a generated key is persisted"`
		TTL        time.Duration `long:"ttl" env:"TTL" default:"720h" description:"session lifetime"`
		Disabled   bool          `long:"disabled" env:"DISABLED" description:"serve without authentication"`
		Secure     string        `long:"secure" env:"SECURE" default:"auto" choice:"auto" choice:"always" choice:"never" description:"Secure flag of the session cookie"`
	} `group:"auth" namespace:"auth" env-namespace:"AUTH"`

	Timeouts struct {
		ReadHeader time.Duration `long:"read-header" env:"READ_HEADER" default:"5s" description:"read header timeout"`
		Read       time.Duration `long:"read" env:"READ" default:"30s" description:"read timeout"`
		Write      time.Duration `long:"write" env:"WRITE" default:"60s" description:"write timeout"`
		Idle       time.Duration `long:"idle" env:"IDLE" default:"60s" description:"idle timeout"`
		Shutdown   time.Duration `long:"shutdown" env:"SHUTDOWN" default:"5s" description:"graceful shutdown timeout"`
	} `group:"timeout" namespace:"timeout" env-namespace:"TIMEOUT"`

	GenHash  string `long:"gen-hash" optional:"yes" optional-value:"-" description:"print a bcrypt hash and exit, reading the password from stdin unless it is given"`
	GenToken string `long:"gen-token" optional:"yes" optional-value:"bot" description:"generate an API token and exit"`
	Version  bool   `short:"v" long:"version" description:"show version and exit"`
	Dbg      bool   `long:"dbg" env:"DEBUG" description:"debug mode"`
}

// byteSize is a size in bytes accepting a human suffix, i.e. "20M" or "512K".
type byteSize int64

// UnmarshalFlag implements the go-flags unmarshaler for byteSize.
func (b *byteSize) UnmarshalFlag(value string) error {
	digits := strings.TrimSuffix(strings.ToUpper(strings.TrimSpace(value)), "B")

	multiplier := int64(1)
	switch {
	case strings.HasSuffix(digits, "K"):
		multiplier = 1 << 10
	case strings.HasSuffix(digits, "M"):
		multiplier = 1 << 20
	case strings.HasSuffix(digits, "G"):
		multiplier = 1 << 30
	}
	if multiplier > 1 {
		digits = digits[:len(digits)-1]
	}

	num, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return fmt.Errorf("parse size %q: %w", value, err)
	}
	if num < 0 {
		return fmt.Errorf("size %q must not be negative", value)
	}

	*b = byteSize(num * multiplier)
	return nil
}

func main() {
	opts, err := parseOpts(os.Args[1:])
	if err != nil {
		var flagsErr *flags.Error
		if errors.As(err, &flagsErr) && flagsErr.Type == flags.ErrHelp {
			fmt.Println(flagsErr.Message)
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	// before setupLog, because a credential read afterwards would never be in
	// the redaction list lgr.Secret was given. The failure is held until the
	// modes that do not serve anything have had their turn.
	cfgs, cfgErr := loadConfig(opts)
	setupLog(opts.Dbg, secretsOf(opts, cfgs)...)

	if opts.Version {
		fmt.Printf("scrawl %s\n", versionInfo())
		return
	}

	if opts.GenHash != "" {
		hash, hashErr := genHash(opts.GenHash, os.Stdin)
		if hashErr != nil {
			log.Printf("[ERROR] %v", hashErr)
			os.Exit(1)
		}
		fmt.Println(hash)
		return
	}

	if opts.GenToken != "" {
		fmt.Println(genToken(opts.GenToken))
		return
	}

	log.Printf("[INFO] scrawl %s", versionInfo())
	log.Printf("[DEBUG] options: %+v", *opts)

	if cfgErr != nil {
		log.Printf("[ERROR] scrawl failed: %v", cfgErr)
		os.Exit(1)
	}
	if err := serve(opts, cfgs); err != nil {
		log.Printf("[ERROR] scrawl failed: %v", err)
		os.Exit(1)
	}
}

// serve runs the server until SIGINT or SIGTERM arrives, or until it fails.
func serve(opts *options, cfgs []projectConfig) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return run(ctx, opts, cfgs)
}

func parseOpts(args []string) (*options, error) {
	var opts options
	p := flags.NewParser(&opts, flags.PassDoubleDash|flags.HelpFlag)
	if _, err := p.ParseArgs(args); err != nil {
		return nil, fmt.Errorf("parse flags: %w", err)
	}
	return &opts, nil
}

func run(ctx context.Context, opts *options, cfgs []projectConfig) error {
	roots, err := validateStartup(ctx, opts, cfgs)
	if err != nil {
		return err
	}

	authSvc, err := auth.NewService(auth.Config{
		Users:        strings.Join(opts.Auth.Users, ","),
		Tokens:       strings.Join(opts.Auth.Tokens, ","),
		Secret:       opts.Auth.Secret,
		SecretFile:   opts.Auth.SecretFile,
		TTL:          opts.Auth.TTL,
		Disabled:     opts.Auth.Disabled,
		TrustedProxy: opts.TrustedProxy,
		Secure:       opts.Auth.Secure,
	})
	if err != nil {
		return fmt.Errorf("setup auth: %w", err)
	}

	running := make([]*runtimeProject, 0, len(cfgs))
	defer func() {
		for _, rp := range running {
			rp.close()
		}
	}()
	srv := &server.Web{
		Config: server.Config{
			ListenAddr:        opts.Listen,
			Title:             opts.Title,
			Version:           versionInfo(),
			ReadOnly:          opts.ReadOnly,
			TrustedProxy:      opts.TrustedProxy,
			MaxUpload:         int64(opts.MaxUpload),
			UploadDir:         strings.Trim(opts.UploadDir, "/"),
			AuthDisabled:      opts.Auth.Disabled,
			ReadHeaderTimeout: opts.Timeouts.ReadHeader,
			ReadTimeout:       opts.Timeouts.Read,
			WriteTimeout:      opts.Timeouts.Write,
			IdleTimeout:       opts.Timeouts.Idle,
			ShutdownTimeout:   opts.Timeouts.Shutdown,
		},
		Auth: authSvc,
	}
	for i, cfg := range cfgs {
		rp, pErr := newProject(ctx, opts, cfg, roots[i])
		if pErr != nil {
			return pErr
		}
		running = append(running, rp)
		srv.Projects = append(srv.Projects, rp.web)
	}

	// the watchers start last, after every project has been reconciled and
	// indexed: a watcher takes its baseline snapshot when it is called, so
	// anything the worktree did before that produces no event, ever
	done := make([]<-chan struct{}, 0, len(running))
	for _, rp := range running {
		done = append(done, watch(ctx, rp, srv))
	}
	runErr := srv.Run(ctx)
	for _, ch := range done {
		<-ch
	}

	if runErr != nil {
		return fmt.Errorf("run server: %w", runErr)
	}
	return nil
}

// the modes of --history.
const (
	historyAuto = "auto"
	historyOn   = "on"
	historyOff  = "off"
)

// the actors a commit is attributed to when no request is behind it.
const (
	historyActorStartup  = "scrawl"
	historyActorExternal = "external"
)

// newHistory builds the history service for the configured mode. "auto" is best
// effort: a host without git, or a notes directory that lies inside another
// repository, leaves the app exactly as it was before the feature existed.
// "on" is a promise the deployment made, so the same conditions stop the server
// rather than serving without the audit trail somebody asked for.
func newHistory(opts *options, cfg projectConfig, notes *store.Store) (*history.Service, error) {
	if opts.History == historyOff {
		return nil, nil
	}

	svc, err := history.New(history.Config{Name: cfg.Name, Root: notes.Dir(), Files: historyFiles(notes)})
	switch {
	case err == nil:
		log.Printf("[INFO] %s: history is on, the git repository is %s", cfg.Name, svc.Root())
		return svc, nil
	case opts.History == historyOn:
		return nil, fmt.Errorf("history is required by --history=%s for project %q: %w", historyOn, cfg.Name, err)
	}
	log.Printf("[WARN] %s: history is off: %v", cfg.Name, err)
	log.Printf("[WARN] nothing else changes, but no version of a document is kept and no change is attributed; "+
		"pass --history=%s to accept that silently, or --history=%s to make it fatal", historyOff, historyOn)
	return nil, nil
}

// historyFiles is what history asks for when it reconciles: every path the
// store still shows, which is the only definition of visible the app has.
func historyFiles(notes *store.Store) func() ([]string, error) {
	return func() ([]string, error) {
		files, err := notes.Files()
		if err != nil {
			return nil, err
		}
		res := make([]string, 0, len(files))
		for _, fi := range files {
			res = append(res, fi.Path)
		}
		return res, nil
	}
}

// reconcile records whatever on disk history has not seen. A failure is never
// fatal: a server that cannot commit is still worth running, the service
// reports itself degraded, and the next successful commit folds the gap in.
func reconcile(ctx context.Context, name string, hist *history.Service, actor string) {
	if !hist.Enabled() || ctx.Err() != nil {
		return
	}
	start := time.Now()
	if err := hist.Reconcile(ctx, actor); err != nil {
		log.Printf("[ERROR] %s: history: record what %s changed: %v", name, actor, err)
		return
	}
	log.Printf("[DEBUG] %s: history: up to date with the notes as %s in %v",
		name, actor, time.Since(start).Round(time.Millisecond))
}

// indexAll fills the search index from the notes directory.
func indexAll(name string, notes *store.Store, index *search.Index) error {
	start := time.Now()
	docs := 0
	err := notes.Walk(func(fi store.FileInfo, data []byte) error {
		index.Set(fi.Path, data)
		docs++
		return nil
	})
	if err != nil {
		return fmt.Errorf("build the search index of %q: %w", name, err)
	}

	log.Printf("[INFO] %s: indexed %d documents in %v, holding %d bytes",
		name, docs, time.Since(start).Round(time.Millisecond), index.Size())
	return nil
}

// historyDebounce is how long the watcher waits after the last change before it
// records the batch. The store already merges a burst into one flush, but that
// flush still arrives as one event per path, and each of them would otherwise
// become a commit of its own.
const historyDebounce = 2 * time.Second

// watch keeps the search index and the rendered page cache in step with the
// disk, and hands whatever changed outside the app to history. The returned
// channel is closed once the goroutine is gone: store.Watch closes its channel
// when ctx is canceled, so shutdown leaks nothing.
func watch(ctx context.Context, rp *runtimeProject, srv *server.Web) <-chan struct{} {
	name := rp.web.Name
	events := rp.notes.Watch(ctx)
	done := make(chan struct{})

	go func() {
		defer close(done)
		batch := time.NewTimer(historyDebounce)
		batch.Stop()
		defer batch.Stop()

		for {
			select {
			case ev, ok := <-events:
				if !ok {
					log.Printf("[DEBUG] %s: watcher stopped", name)
					return
				}
				log.Printf("[DEBUG] %s: change on %s: %s", name, ev.Path, ev.Op)
				srv.Invalidate(name, ev.Path)
				reindex(rp.notes, rp.index, ev.Path)
				if rp.hist.Enabled() {
					batch.Reset(historyDebounce)
				}
			case <-batch.C:
				// what the app itself wrote is committed already, so this
				// mostly finds nothing; the edit made over SMB is the point
				reconcile(ctx, name, rp.hist, historyActorExternal)
			}
		}
	}()
	return done
}

// reindex brings the search index back in step with one path.
func reindex(notes *store.Store, index *search.Index, p string) {
	if !strings.EqualFold(path.Ext(p), ".md") {
		return
	}
	// a create and a write mean the same thing here, and so does a rename: an
	// atomic save replaces the inode, so the file that is there now is the only
	// thing worth asking about
	data, _, err := notes.Read(p)
	if err != nil {
		index.Delete(p)
		return
	}
	index.Set(p, data)
}

// validateStartup runs both phases of validation and returns the canonical root
// of every project. The syntactic phase comes first and needs nothing on disk,
// so a typo fails before a directory is created or a repository cloned; the
// canonical one answers what only a resolved path can.
func validateStartup(ctx context.Context, opts *options, cfgs []projectConfig) ([]string, error) {
	if opts.Config != "" && (opts.Root != defaultRoot || opts.Project != "") {
		log.Printf("[WARN] --config wins, --root and --project are ignored")
	}
	if err := validateGlobal(opts); err != nil {
		return nil, err
	}
	if err := validateProjects(ctx, cfgs); err != nil {
		return nil, err
	}
	roots, rootsErr := resolveRoots(cfgs)
	if rootsErr != nil {
		return nil, rootsErr
	}
	if err := checkSecretFile(roots, opts); err != nil {
		return nil, err
	}
	if opts.Auth.Disabled {
		log.Printf("[WARN] authentication is disabled, every visitor gets full access")
	}
	return roots, nil
}

// validateGlobal checks the options no project owns.
func validateGlobal(opts *options) error {
	if !opts.Auth.Disabled && len(opts.Auth.Users) == 0 && len(opts.Auth.Tokens) == 0 {
		return errors.New("no users and no tokens configured, " +
			"set --auth.users or --auth.tokens, or run with --auth.disabled")
	}
	return nil
}

// genHash turns a password into a bcrypt hash. "-", which is what --gen-hash
// means on its own, reads the password from in: a password given on the command
// line lands in ps, in the shell history and, for the documented docker run
// recipe, in the container config that docker inspect prints.
func genHash(value string, in io.Reader) (string, error) {
	password := value
	if value == "-" {
		line, err := bufio.NewReader(in).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", fmt.Errorf("read the password from stdin: %w", err)
		}
		password = strings.TrimRight(line, "\r\n")
		if password == "" {
			return "", errors.New("no password on stdin, pipe one in " +
				"(printf 'my-password' | scrawl --gen-hash) or pass it as --gen-hash=my-password")
		}
	} else {
		log.Printf("[WARN] the password was passed on the command line, where ps and the shell history keep it, " +
			"pipe it into --gen-hash instead")
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return "", err
	}
	return hash, nil
}

// genToken makes an API token and the configuration entry that accepts it. The
// token is printed once and never stored: the configuration holds its digest
// only, so a leaked tokens list cannot be turned back into a credential.
func genToken(name string) string {
	token := auth.GenerateToken()
	return "token, hand this to the client: " + token + "\n" +
		"configuration entry for --auth.tokens: " + name + ":" + auth.TokenDigest(token)
}

// secretsOf collects values that must never reach the log. An entry with no
// colon in it counts as a secret whole: a token carries no natural name, so
// forgetting one is easy, and what is left is the credential itself.
func secretsOf(opts *options, cfgs []projectConfig) []string {
	res := make([]string, 0, len(opts.Auth.Users)+len(opts.Auth.Tokens)+len(cfgs)+1)
	if opts.Auth.Secret != "" {
		res = append(res, opts.Auth.Secret)
	}
	// the resolved repository credentials, whatever they were read from: this
	// is the second line of defense behind the structural redaction gitError
	// does, and it is why the config is loaded before setupLog
	for _, cfg := range cfgs {
		if cfg.Remote != nil && cfg.Remote.Token != "" {
			res = append(res, cfg.Remote.Token)
		}
	}
	for _, entry := range slices.Concat(opts.Auth.Users, opts.Auth.Tokens) {
		secret := entry
		if _, rest, found := strings.Cut(entry, ":"); found {
			secret = rest
		}
		if secret != "" {
			res = append(res, secret)
		}
	}
	return res
}

// versionInfo returns the revision injected via ldflags and falls back to go's
// build info for `go install` builds.
func versionInfo() string {
	if revision != "0.0.0" {
		return revision
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" {
		return info.Main.Version
	}
	return revision
}

func setupLog(dbg bool, secrets ...string) {
	// no stack trace outside debug mode: an ordinary configuration error would
	// otherwise print a dump that reads as a crash in Container Manager's log
	logOpts := []lgr.Option{lgr.Msec, lgr.LevelBraces}
	if dbg {
		logOpts = []lgr.Option{lgr.Debug, lgr.CallerFile, lgr.CallerFunc, lgr.Msec,
			lgr.LevelBraces, lgr.StackTraceOnError}
	}

	colorizer := lgr.Mapper{
		ErrorFunc:  func(s string) string { return color.New(color.FgHiRed).Sprint(s) },
		WarnFunc:   func(s string) string { return color.New(color.FgRed).Sprint(s) },
		InfoFunc:   func(s string) string { return color.New(color.FgYellow).Sprint(s) },
		DebugFunc:  func(s string) string { return color.New(color.FgWhite).Sprint(s) },
		CallerFunc: func(s string) string { return color.New(color.FgBlue).Sprint(s) },
		TimeFunc:   func(s string) string { return color.New(color.FgCyan).Sprint(s) },
	}
	logOpts = append(logOpts, lgr.Map(colorizer))

	if len(secrets) > 0 {
		logOpts = append(logOpts, lgr.Secret(secrets...))
	}

	lgr.SetupStdLogger(logOpts...)
	lgr.Setup(logOpts...)
}
