package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/fatih/color"
	"github.com/go-pkgz/lgr"
	"github.com/jessevdk/go-flags"
	"golang.org/x/crypto/bcrypt"

	"github.com/aleksey925/mdserver/server"
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
	TrustedProxy bool     `long:"trusted-proxy" env:"TRUSTED_PROXY" description:"trust X-Forwarded-For and X-Forwarded-Proto"`

	Auth struct {
		Users    []string      `long:"users" env:"USERS" env-delim:"," description:"user:bcryptHashOrPlainPassword pairs"`
		Secret   string        `long:"secret" env:"SECRET" description:"cookie signing key, generated and persisted if empty"`
		TTL      time.Duration `long:"ttl" env:"TTL" default:"720h" description:"session lifetime"`
		Disabled bool          `long:"disabled" env:"DISABLED" description:"serve without authentication"`
	} `group:"auth" namespace:"auth" env-namespace:"AUTH"`

	Timeouts struct {
		ReadHeader time.Duration `long:"read-header" env:"READ_HEADER" default:"5s" description:"read header timeout"`
		Read       time.Duration `long:"read" env:"READ" default:"30s" description:"read timeout"`
		Write      time.Duration `long:"write" env:"WRITE" default:"60s" description:"write timeout"`
		Idle       time.Duration `long:"idle" env:"IDLE" default:"60s" description:"idle timeout"`
		Shutdown   time.Duration `long:"shutdown" env:"SHUTDOWN" default:"5s" description:"graceful shutdown timeout"`
	} `group:"timeout" namespace:"timeout" env-namespace:"TIMEOUT"`

	GenHash string `long:"gen-hash" description:"print a bcrypt hash for the given password and exit"`
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
		hash, hashErr := genHash(opts.GenHash)
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
	for _, name := range plainPasswordUsers(opts.Auth.Users) {
		log.Printf("[WARN] user %q has a plain password, use --gen-hash to make a bcrypt hash", name)
	}

	if opts.Auth.Disabled {
		log.Printf("[WARN] authentication is disabled, every visitor gets full access")
	}

	srv := &server.Web{Config: server.Config{
		ListenAddr:        opts.Listen,
		RootDir:           root,
		Title:             opts.Title,
		Version:           versionInfo(),
		ReadOnly:          opts.ReadOnly,
		TrustedProxy:      opts.TrustedProxy,
		MaxUpload:         int64(opts.MaxUpload),
		AuthDisabled:      opts.Auth.Disabled,
		ReadHeaderTimeout: opts.Timeouts.ReadHeader,
		ReadTimeout:       opts.Timeouts.Read,
		WriteTimeout:      opts.Timeouts.Write,
		IdleTimeout:       opts.Timeouts.Idle,
		ShutdownTimeout:   opts.Timeouts.Shutdown,
	}}

	// TODO(agent): build store, render, search and auth here and hand them to server.Web

	if err := srv.Run(ctx); err != nil {
		return fmt.Errorf("run server: %w", err)
	}
	return nil
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

	return root, nil
}

func genHash(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("generate bcrypt hash: %w", err)
	}
	return string(hash), nil
}

// plainPasswordUsers returns the names of users configured with a plain
// password instead of a bcrypt hash. They work, but the password then sits in
// the process environment and in the compose file.
func plainPasswordUsers(users []string) []string {
	res := []string{}
	for _, entry := range users {
		name, secret, found := strings.Cut(entry, ":")
		if !found || strings.HasPrefix(secret, "$2") {
			continue
		}
		res = append(res, name)
	}
	return res
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
	logOpts := []lgr.Option{lgr.Msec, lgr.LevelBraces, lgr.StackTraceOnError}
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
