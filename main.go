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

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/format"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/plantuml"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/server"
	"github.com/aleksey925/scrawl/store"
)

var revision = "0.0.0"

const (
	defaultSpaceDir   = "/spaces/notes"
	defaultFormat     = formatOn
	defaultRepoBranch = "main"
	defaultRepoPull   = 5 * time.Minute
)

const formatWorkers = 2

const plantumlWorkers = 1

const (
	formatOn  = "on"
	formatOff = "off"
)

type spaceOptions struct {
	Name string `long:"name" env:"NAME" description:"name of the single space, the URL segment it is served under"`
	Dir  string `long:"dir" env:"DIR" default:"/spaces/notes" description:"directory of the single space"`

	FormatOnSave string `long:"format-on-save" env:"FORMAT_ON_SAVE" default:"on" choice:"on" choice:"off" description:"format a note with prettier whenever it is saved"`
}

type options struct {
	Space      spaceOptions `group:"space" namespace:"space" env-namespace:"SPACE"`
	SpacesFile string       `long:"spaces-file" env:"SPACES_FILE" description:"yaml file declaring several spaces, replaces every --space and --repo option"`

	Listen       string   `short:"l" long:"listen" env:"LISTEN" default:":7272" description:"address to listen on"`
	SiteTitle    string   `long:"site-title" env:"SITE_TITLE" default:"Notes" description:"name of the site: the browser tab, the sign-in page, the home screen icon"`
	ReadOnly     bool     `long:"read-only" env:"READ_ONLY" description:"disable all write endpoints"`
	Exclude      []string `long:"exclude" env:"EXCLUDE" env-delim:"," description:"extra ignore globs"`
	MaxUpload    byteSize `long:"max-upload" env:"MAX_UPLOAD" default:"20M" description:"upload size cap"`
	UploadDir    string   `long:"upload-dir" env:"UPLOAD_DIR" description:"put every upload in this one directory instead of a folder named after the document"`
	TrustedProxy bool     `long:"trusted-proxy" env:"TRUSTED_PROXY" description:"trust X-Forwarded-For and X-Forwarded-Proto"`

	Watch  string        `long:"watch" env:"WATCH" default:"auto" choice:"auto" choice:"poll" description:"change detection, poll for a network share"`
	Rescan time.Duration `long:"rescan" env:"RESCAN" default:"60s" description:"periodic full rescan, negative disables it unless watch is poll"`

	History string `long:"history" env:"HISTORY" default:"auto" choice:"auto" choice:"on" choice:"off" description:"document history in git"`

	Repo struct {
		URL    string        `long:"url" env:"URL" description:"clone this git remote into --space.dir and push what is edited back"`
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

	Dbg bool `long:"dbg" env:"DEBUG" description:"debug mode"`
}

type byteSize int64

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
	format.RunWorkerIfAsked()
	plantuml.RunWorkerIfAsked()
	os.Exit(runCommand(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func runServe(opts *options) int {
	cfgs, cfgErr := loadConfig(opts)
	setupLog(opts.Dbg, secretsOf(opts, cfgs)...)

	log.Printf("[INFO] scrawl %s", versionInfo())
	log.Printf("[DEBUG] options: %+v", *opts)

	if cfgErr != nil {
		log.Printf("[ERROR] scrawl failed: %v", cfgErr)
		return 1
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, opts, cfgs); err != nil {
		log.Printf("[ERROR] scrawl failed: %v", err)
		return 1
	}
	return 0
}

func parseOpts(args []string) (*options, error) {
	cmds, _, err := parseCommands(append([]string{serveCommand}, args...))
	if err != nil {
		return nil, err
	}
	return &cmds.Serve, nil
}

func run(ctx context.Context, opts *options, cfgs []spaceConfig) error {
	roots, err := validateStartup(ctx, opts, cfgs)
	if err != nil {
		return err
	}

	running := make([]*runtimeSpace, 0, len(cfgs))
	defer func() {
		for _, rp := range running {
			rp.close()
		}
	}()
	spaces := make([]*server.Space, 0, len(cfgs))
	hooks := make([]string, 0, len(cfgs))
	for i, cfg := range cfgs {
		rp, pErr := newSpace(ctx, opts, cfg, roots[i])
		if pErr != nil {
			return pErr
		}
		running = append(running, rp)
		spaces = append(spaces, rp.web)
		if rp.web.Webhook != nil {
			hooks = append(hooks, rp.web.HookPath())
		}
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
		PublicPaths:  hooks,
	})
	if err != nil {
		return fmt.Errorf("setup auth: %w", err)
	}

	formatter := format.New(formatWorkers)
	defer formatter.Close()
	diagrams := plantuml.New(plantumlWorkers)
	defer diagrams.Close()

	srv := &server.Web{
		Config: server.Config{
			ListenAddr:        opts.Listen,
			Title:             opts.SiteTitle,
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
		Spaces:    spaces,
		Auth:      authSvc,
		Formatter: formatter,
		Diagrams:  diagrams,
	}

	workers, stopWorkers := context.WithCancel(ctx)
	done := startWorkers(workers, running, srv)
	runErr := srv.Run(ctx)
	stopWorkers()
	for _, ch := range done {
		<-ch
	}

	if runErr != nil {
		return fmt.Errorf("run server: %w", runErr)
	}
	return nil
}

func startWorkers(ctx context.Context, running []*runtimeSpace, srv *server.Web) []<-chan struct{} {
	done := make([]<-chan struct{}, 0, 2*len(running))
	for _, rp := range running {
		done = append(done, watch(ctx, rp, srv))
		if rp.pull > 0 || rp.web.Webhook != nil {
			done = append(done, syncLoop(ctx, rp, syncRemote))
		}
	}
	return done
}

type syncFunc func(ctx context.Context, name string, hist *history.Service)

func syncLoop(ctx context.Context, rp *runtimeSpace, run syncFunc) <-chan struct{} {
	name := rp.web.Name
	done := make(chan struct{})

	go func() {
		defer close(done)
		var tick <-chan time.Time
		if rp.pull > 0 {
			ticker := time.NewTicker(rp.pull)
			defer ticker.Stop()
			tick = ticker.C
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-tick:
			case <-rp.trigger:
			}
			if ctx.Err() != nil {
				return
			}
			run(ctx, name, rp.hist)
		}
	}()
	return done
}

const (
	historyAuto = "auto"
	historyOn   = "on"
	historyOff  = "off"
)

const (
	historyActorStartup  = "scrawl"
	historyActorExternal = "external"
)

func newHistory(opts *options, cfg spaceConfig, notes *store.Store) (*history.Service, error) {
	hcfg := history.Config{
		Name:    cfg.Name,
		Root:    notes.Dir(),
		Files:   historyFiles(notes),
		Visible: notes.Visible,
	}
	remote := cfg.Remote != nil
	if remote {
		rm := remoteOf(opts, cfg)
		hcfg.Remote, hcfg.TrackAll = &rm, true
	}
	if opts.History == historyOff {
		if !remote {
			return nil, nil
		}
		log.Printf("[WARN] %s: --history=%s does not apply, a space that tracks a remote has to record "+
			"before it can push", cfg.Name, historyOff)
	}

	svc, err := history.New(hcfg)
	switch {
	case err == nil:
		log.Printf("[INFO] %s: history is on, the git repository is %s", cfg.Name, svc.Root())
		return svc, nil
	case remote:
		return nil, fmt.Errorf("the repository of space %q could not be opened: %w", cfg.Name, err)
	case opts.History == historyOn:
		return nil, fmt.Errorf("history is required by --history=%s for space %q: %w", historyOn, cfg.Name, err)
	}
	log.Printf("[WARN] %s: history is off: %v", cfg.Name, err)
	log.Printf("[WARN] nothing else changes, but no version of a document is kept and no change is attributed; "+
		"pass --history=%s to accept that silently, or --history=%s to make it fatal", historyOff, historyOn)
	return nil, nil
}

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

func reconcile(ctx context.Context, name string, hist *history.Service, actor string) {
	if !hist.Enabled() || hist.PullOnly() || ctx.Err() != nil {
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

func syncRemote(ctx context.Context, name string, hist *history.Service) {
	if !hist.Remote() || ctx.Err() != nil {
		return
	}
	start := time.Now()
	if err := hist.Sync(ctx); err != nil {
		log.Printf("[ERROR] %s: %v", name, err)
		return
	}
	log.Printf("[DEBUG] %s: in step with the remote in %v", name, time.Since(start).Round(time.Millisecond))
}

func probeWritable(ctx context.Context, name string, hist *history.Service) {
	if !hist.Remote() || ctx.Err() != nil {
		return
	}
	if err := hist.ProbeWritable(ctx); err != nil {
		log.Printf("[WARN] %s: the remote refuses a push, every save will stay in this container: %v", name, err)
		log.Printf("[WARN] give the space a credential with repo.token_file or repo.token_env, " +
			"or mark it read_only if that is what you meant")
	}
}

func pullEvery(cfg spaceConfig) time.Duration {
	if cfg.Remote == nil {
		return 0
	}
	return cfg.Remote.Pull
}

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

const historyDebounce = 2 * time.Second

func watch(ctx context.Context, rp *runtimeSpace, srv *server.Web) <-chan struct{} {
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
				reconcile(ctx, name, rp.hist, historyActorExternal)
			}
		}
	}()
	return done
}

func reindex(notes *store.Store, index *search.Index, p string) {
	if !strings.EqualFold(path.Ext(p), ".md") {
		return
	}
	data, _, err := notes.Read(p)
	if err != nil {
		index.Delete(p)
		return
	}
	index.Set(p, data)
}

func ignoredSpaceSettings(opts *options) []string {
	if opts.SpacesFile == "" {
		return nil
	}
	_, hasToken := os.LookupEnv(repoTokenEnv)
	_, hasHookSecret := os.LookupEnv(repoHookSecretEnv)
	given := []struct {
		name string
		set  bool
	}{
		{name: "SPACE_NAME", set: opts.Space.Name != ""},
		{name: "SPACE_DIR", set: opts.Space.Dir != defaultSpaceDir},
		{name: "SPACE_FORMAT_ON_SAVE", set: opts.Space.FormatOnSave != defaultFormat},
		{name: "REPO_URL", set: opts.Repo.URL != ""},
		{name: "REPO_BRANCH", set: opts.Repo.Branch != defaultRepoBranch},
		{name: "REPO_PULL", set: opts.Repo.Pull != defaultRepoPull},
		{name: repoTokenEnv, set: hasToken},
		{name: repoHookSecretEnv, set: hasHookSecret},
	}
	res := make([]string, 0, len(given))
	for _, setting := range given {
		if setting.set {
			res = append(res, setting.name)
		}
	}
	return res
}

func validateStartup(ctx context.Context, opts *options, cfgs []spaceConfig) ([]string, error) {
	if ignored := ignoredSpaceSettings(opts); len(ignored) > 0 {
		log.Printf("[WARN] SPACES_FILE is set, so these are ignored: %s", strings.Join(ignored, ", "))
	}
	if err := validateGlobal(opts); err != nil {
		return nil, err
	}
	if err := validateSpaces(ctx, cfgs); err != nil {
		return nil, err
	}
	if err := ensureDirs(ctx, opts, cfgs); err != nil {
		return nil, err
	}
	roots, rootsErr := resolveRoots(cfgs)
	if rootsErr != nil {
		return nil, rootsErr
	}
	if err := checkSecretFiles(roots, opts, cfgs); err != nil {
		return nil, err
	}
	if opts.Auth.Disabled {
		log.Printf("[WARN] authentication is disabled, every visitor gets full access")
	}
	return roots, nil
}

func validateGlobal(opts *options) error {
	if !opts.Auth.Disabled && len(opts.Auth.Users) == 0 && len(opts.Auth.Tokens) == 0 {
		return errors.New("no users and no tokens configured, " +
			"set --auth.users or --auth.tokens, or run with --auth.disabled")
	}
	return nil
}

func genHash(value string, in io.Reader) (string, error) {
	password := value
	if value == "" || value == "-" {
		line, err := bufio.NewReader(in).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", fmt.Errorf("read the password from stdin: %w", err)
		}
		password = strings.TrimRight(line, "\r\n")
		if password == "" {
			return "", errors.New("no password on stdin, pipe one in " +
				"(printf 'my-password' | scrawl hash) or pass it as an argument")
		}
	} else {
		log.Printf("[WARN] the password was passed on the command line, where ps and the shell history keep it, " +
			"pipe it into scrawl hash instead")
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return "", err
	}
	return hash, nil
}

func genToken(name string) string {
	token := auth.GenerateToken()
	return "token, hand this to the client: " + token + "\n" +
		"configuration entry for --auth.tokens: " + name + ":" + auth.TokenDigest(token)
}

func secretsOf(opts *options, cfgs []spaceConfig) []string {
	res := make([]string, 0, len(opts.Auth.Users)+len(opts.Auth.Tokens)+len(cfgs)+1)
	if opts.Auth.Secret != "" {
		res = append(res, opts.Auth.Secret)
	}
	for _, cfg := range cfgs {
		if cfg.Remote == nil {
			continue
		}
		for _, secret := range []string{cfg.Remote.Token, cfg.Remote.HookSecret} {
			if secret != "" {
				res = append(res, secret)
			}
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
