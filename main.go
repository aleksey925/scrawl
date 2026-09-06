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
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/fatih/color"
	"github.com/go-pkgz/lgr"
	"github.com/jessevdk/go-flags"

	"github.com/aleksey925/mdserver/auth"
	"github.com/aleksey925/mdserver/render"
	"github.com/aleksey925/mdserver/search"
	"github.com/aleksey925/mdserver/server"
	"github.com/aleksey925/mdserver/store"
)

// revision is set at build time with -ldflags "-X main.revision=..."
var revision = "unknown"

type options struct {
	Root         string   `short:"r" long:"root" env:"ROOT" default:"/kb" description:"knowledge base root directory"`
	Listen       string   `short:"l" long:"listen" env:"LISTEN" default:":8080" description:"address to listen on"`
	Title        string   `long:"title" env:"TITLE" default:"Knowledge Base" description:"site title"`
	ReadOnly     bool     `long:"read-only" env:"READ_ONLY" description:"disable all write endpoints"`
	Exclude      []string `long:"exclude" env:"EXCLUDE" env-delim:"," description:"extra ignore globs"`
	MaxUpload    byteSize `long:"max-upload" env:"MAX_UPLOAD" default:"20M" description:"upload size cap"`
	UploadDir    string   `long:"upload-dir" env:"UPLOAD_DIR" description:"put every upload in this one directory instead of a folder named after the document"`
	TrustedProxy bool     `long:"trusted-proxy" env:"TRUSTED_PROXY" description:"trust X-Forwarded-For and X-Forwarded-Proto"`

	Watch  string        `long:"watch" env:"WATCH" default:"auto" choice:"auto" choice:"poll" description:"change detection, poll for a network share"`
	Rescan time.Duration `long:"rescan" env:"RESCAN" default:"60s" description:"periodic full rescan, negative disables it unless watch is poll"`

	Auth struct {
		Users      []string      `long:"users" env:"USERS" env-delim:"," description:"user:bcryptHashOrPlainPassword pairs"`
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

	GenHash string `long:"gen-hash" optional:"yes" optional-value:"-" description:"print a bcrypt hash and exit, reading the password from stdin unless it is given"`
	Version bool   `short:"v" long:"version" description:"show version and exit"`
	Dbg     bool   `long:"dbg" env:"DEBUG" description:"debug mode"`
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

	setupLog(opts.Dbg, secretsOf(opts)...)

	if opts.Version {
		fmt.Printf("mdserver %s\n", versionInfo())
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

	log.Printf("[INFO] mdserver %s", versionInfo())
	log.Printf("[DEBUG] options: %+v", *opts)

	if err := serve(opts); err != nil {
		log.Printf("[ERROR] mdserver failed: %v", err)
		os.Exit(1)
	}
}

// serve runs the server until SIGINT or SIGTERM arrives, or until it fails.
func serve(opts *options) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return run(ctx, opts)
}

func parseOpts(args []string) (*options, error) {
	var opts options
	p := flags.NewParser(&opts, flags.PassDoubleDash|flags.HelpFlag)
	if _, err := p.ParseArgs(args); err != nil {
		return nil, fmt.Errorf("parse flags: %w", err)
	}
	return &opts, nil
}

func run(ctx context.Context, opts *options) error {
	root, err := validate(opts)
	if err != nil {
		return err
	}
	if opts.Auth.Disabled {
		log.Printf("[WARN] authentication is disabled, every visitor gets full access")
	}

	kb, err := store.New(store.Config{
		Root:     root,
		Exclude:  opts.Exclude,
		ReadOnly: opts.ReadOnly,
		Watch:    store.WatchMode(opts.Watch),
		Rescan:   opts.Rescan,
	})
	if err != nil {
		return fmt.Errorf("open knowledge base: %w", err)
	}
	defer kb.Close()
	warnUnwritable(kb)

	index := search.New()
	if indexErr := indexAll(kb, index); indexErr != nil {
		return indexErr
	}

	authSvc, err := auth.NewService(auth.Config{
		Users:        strings.Join(opts.Auth.Users, ","),
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
		Store:    kb,
		Renderer: render.New(render.Options{LinkExists: kb.Exists}),
		Index:    index,
		Auth:     authSvc,
	}

	watchDone := watch(ctx, kb, index, srv)
	runErr := srv.Run(ctx)
	<-watchDone

	if runErr != nil {
		return fmt.Errorf("run server: %w", runErr)
	}
	return nil
}

// warnUnwritable names the failure a NAS deployment hits first: the container
// runs as a uid that does not own the mounted folder, reading works and every
// save comes back as an error. One line at startup beats finding out later.
func warnUnwritable(kb *store.Store) {
	if kb.ReadOnly() {
		return
	}
	if err := kb.CheckWritable(); err != nil {
		log.Printf("[WARN] %s is not writable by uid %d gid %d, every save will fail: %v", kb.Dir(), os.Getuid(), os.Getgid(), err)
		log.Printf("[WARN] set the container user to the owner of that folder (`id <user>` on the NAS gives the numbers), " +
			"or start with --read-only")
	}
}

// indexAll fills the search index from the knowledge base.
func indexAll(kb *store.Store, index *search.Index) error {
	start := time.Now()
	docs := 0
	err := kb.Walk(func(fi store.FileInfo, data []byte) error {
		index.Set(fi.Path, data)
		docs++
		return nil
	})
	if err != nil {
		return fmt.Errorf("build search index: %w", err)
	}

	log.Printf("[INFO] indexed %d documents in %v, holding %d bytes",
		docs, time.Since(start).Round(time.Millisecond), index.Size())
	return nil
}

// watch keeps the search index and the rendered page cache in step with the
// disk. The returned channel is closed once the goroutine is gone: store.Watch
// closes its channel when ctx is canceled, so shutdown leaks nothing.
func watch(ctx context.Context, kb *store.Store, index *search.Index, srv *server.Web) <-chan struct{} {
	events := kb.Watch(ctx)
	done := make(chan struct{})

	go func() {
		defer close(done)
		for ev := range events {
			log.Printf("[DEBUG] change on %s: %s", ev.Path, ev.Op)
			srv.Invalidate(ev.Path)
			if !strings.EqualFold(path.Ext(ev.Path), ".md") {
				continue
			}
			// a create and a write mean the same thing here, and so does a
			// rename: an atomic save replaces the inode, so the file that is
			// there now is the only thing worth asking about
			data, _, err := kb.Read(ev.Path)
			if err != nil {
				index.Delete(ev.Path)
				continue
			}
			index.Set(ev.Path, data)
		}
		log.Printf("[DEBUG] watcher stopped")
	}()
	return done
}

// validate checks the options and returns the absolute knowledge base root.
func validate(opts *options) (string, error) {
	root, err := filepath.Abs(opts.Root)
	if err != nil {
		return "", fmt.Errorf("absolute path for root %q: %w", opts.Root, err)
	}

	fi, err := os.Stat(root)
	if err != nil {
		return "", fmt.Errorf("root directory %q: %w", root, err)
	}
	if !fi.IsDir() {
		return "", fmt.Errorf("root %q is not a directory", root)
	}

	if !opts.Auth.Disabled && len(opts.Auth.Users) == 0 {
		return "", errors.New("no users configured, set --auth.users or run with --auth.disabled")
	}
	if err := checkSecretFile(root, opts); err != nil {
		return "", err
	}

	return root, nil
}

// checkSecretFile refuses a signing key stored inside the knowledge base: it
// would show up in the tree, in the search index and in every backup of the
// corpus, and anybody holding it can forge a session cookie.
func checkSecretFile(root string, opts *options) error {
	if opts.Auth.Disabled || opts.Auth.SecretFile == "" {
		return nil
	}

	secret, err := filepath.Abs(opts.Auth.SecretFile)
	if err != nil {
		return fmt.Errorf("absolute path for secret file %q: %w", opts.Auth.SecretFile, err)
	}
	if secret != root && !strings.HasPrefix(secret, root+string(filepath.Separator)) {
		return nil
	}
	return fmt.Errorf("secret file %q must live outside the knowledge base root %q", opts.Auth.SecretFile, root)
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
				"(printf 'my-password' | mdserver --gen-hash) or pass it as --gen-hash=my-password")
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

// secretsOf collects values that must never reach the log.
func secretsOf(opts *options) []string {
	res := make([]string, 0, len(opts.Auth.Users)+1)
	if opts.Auth.Secret != "" {
		res = append(res, opts.Auth.Secret)
	}
	for _, entry := range opts.Auth.Users {
		if _, secret, found := strings.Cut(entry, ":"); found && secret != "" {
			res = append(res, secret)
		}
	}
	return res
}

// versionInfo returns the revision injected via ldflags and falls back to go's
// build info for `go install` builds.
func versionInfo() string {
	if revision != "unknown" {
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
