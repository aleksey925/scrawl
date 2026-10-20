package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/jessevdk/go-flags"

	"github.com/aleksey925/scrawl/format"
	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/render"
)

// the names of the commands
const (
	serveCommand  = "serve"
	renderCommand = "render"
	siteCommand   = "site"
	diffCommand   = "diff"
	formatCommand = "format"
	styleCommand  = "stylesheet"
	hashCommand   = "hash"
	tokenCommand  = "token"
)

// the output formats of render and diff
const (
	outputPage     = "page"
	outputFragment = "fragment"
	outputJSON     = "json"
)

// commands is the whole command line. The server is one command; the others
// are the same renderer, comparison and formatter used without it, on files
// the caller names.
type commands struct {
	Version bool `short:"v" long:"version" description:"show version and exit"`

	Serve      options       `command:"serve" description:"serve directories of notes as a web app"`
	Render     renderOptions `command:"render" description:"render a markdown file to HTML"`
	Site       siteOptions   `command:"site" description:"write a directory of notes as a static site, a page for every note"`
	Diff       diffOptions   `command:"diff" description:"compare markdown as it reads, two files or two revisions of a git repository"`
	Format     formatOptions `command:"format" description:"format markdown with the prettier the server runs"`
	Hash       hashOptions   `command:"hash" description:"print a bcrypt hash of a password for --auth.users"`
	Token      tokenOptions  `command:"token" description:"generate an API token and its entry for --auth.tokens"`
	Stylesheet struct{}      `command:"stylesheet" description:"print the stylesheet a fragment of render and diff is drawn with"`
}

// example is one line of a command's help: a command line and what it does.
type example struct {
	line, what string
}

// the help of a command is laid out for a terminal this wide, the width go-flags
// wraps to when it cannot ask the terminal
const (
	helpWidth     = 80
	exampleIndent = "  "
	exampleGap    = "   "
)

var commandExamples = map[string][]example{
	serveCommand: {
		{"scrawl serve --space.dir ~/notes --space.name notes --auth.users 'alex:my-password'", "one folder, one user"},
		{"scrawl serve --space.dir ~/notes --space.name notes --auth.disabled", "no sign-in, on your own machine"},
		{"SPACES_FILE=spaces.yml AUTH_USERS='alex:my-password' scrawl serve", "several spaces from a file"},
	},
	renderCommand: {
		{"scrawl render note.md -o note.html", "a page that opens on its own"},
		{"scrawl render note.md -f fragment", "the HTML alone, for your own page"},
		{"scrawl render note.md -f json", "HTML, title, outline, frontmatter"},
		{"scrawl render --math note.md", "formulas typeset with KaTeX"},
		{"cat note.md | scrawl render > note.html", "from standard input"},
	},
	siteCommand: {
		{"scrawl site -o site notes", "notes/ as a static site"},
		{"scrawl site -o site --exclude 'drafts/**' notes", "the same, without drafts/"},
	},
	diffCommand: {
		{"scrawl diff old.md new.md -o diff.html", "two files"},
		{"scrawl diff", "HEAD against the working tree"},
		{"scrawl diff HEAD~3", "HEAD~3 against the working tree"},
		{"scrawl diff main..HEAD", "main against HEAD"},
		{"scrawl diff main...HEAD -- docs", "a branch since main, docs/ only"},
		{"scrawl diff v1.0 v1.1 -f json", "two revisions, as JSON"},
		{"scrawl diff --exit-code", "exit with 1 when some text changed"},
	},
	formatCommand: {
		{"scrawl format note.md", "print the note formatted"},
		{"scrawl format -w notes/*.md", "write the result back to every file"},
		{"scrawl format -c notes/*.md", "list the files that would change"},
		{"cat note.md | scrawl format", "from standard input"},
	},
	styleCommand: {
		{"scrawl stylesheet > scrawl.css", "save it to link from your page"},
	},
	hashCommand: {
		{"printf 'my-password' | scrawl hash", "the password from standard input"},
	},
	tokenCommand: {
		{"scrawl token", "a token named bot"},
		{"scrawl token ci", "a token named ci"},
	},
}

// helpFooter is what follows the help go-flags prints: the examples of one
// command, or a pointer to them. They are printed here and not as a long
// description, because go-flags rewraps that and drops the indent of columns.
func helpFooter(command string) string {
	examples, ok := commandExamples[command]
	if !ok {
		return "Run scrawl <command> -h for the options and examples of one command.\n"
	}
	return formatExamples(examples)
}

// formatExamples puts the examples in two columns, or, when the columns would
// not fit in helpWidth, each description on a line above its command.
func formatExamples(examples []example) string {
	lineWidth, whatWidth := 0, 0
	for _, ex := range examples {
		lineWidth = max(lineWidth, len(ex.line))
		whatWidth = max(whatWidth, len(ex.what))
	}
	var b strings.Builder
	b.WriteString("Examples:\n")
	if len(exampleIndent)+lineWidth+len(exampleGap)+whatWidth <= helpWidth {
		for _, ex := range examples {
			fmt.Fprintf(&b, "%s%-*s%s%s\n", exampleIndent, lineWidth, ex.line, exampleGap, ex.what)
		}
		return b.String()
	}
	for i, ex := range examples {
		if i > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "%s# %s\n%s%s\n", exampleIndent, ex.what, exampleIndent, ex.line)
	}
	return b.String()
}

// sentence turns a command's short description into the line its own help
// opens with.
func sentence(text string) string {
	if text == "" {
		return ""
	}
	return strings.ToUpper(text[:1]) + text[1:] + "."
}

// outputOptions are where a command writes and in which shape.
type outputOptions struct {
	Output string `short:"o" long:"output" description:"file to write, standard output when absent"`
	Format string `short:"f" long:"format" default:"page" choice:"page" choice:"fragment" choice:"json" description:"a page that opens on its own, an HTML fragment, or JSON"`
	// a relative link is kept as written outside the app, and a site built of
	// rendered notes needs a.md to become a.html
	LinkExt string `long:"link-ext" description:"replace the .md of a relative link with this extension, such as .html"`
	Math    bool   `long:"math" description:"typeset formulas in a page with KaTeX, which makes it some 600KB larger"`
}

type renderOptions struct {
	outputOptions
	Args struct {
		File string `positional-arg-name:"FILE" description:"markdown to render, standard input when absent or -"`
	} `positional-args:"yes"`
}

type formatOptions struct {
	Write bool `short:"w" long:"write" description:"write the result back to every file instead of printing it"`
	Check bool `short:"c" long:"check" description:"print the files that would change, and exit with 1 if any would"`
	Args  struct {
		Files []string `positional-arg-name:"FILE" description:"markdown to format, standard input when absent or -"`
	} `positional-args:"yes"`
}

type hashOptions struct {
	Args struct {
		Password string `positional-arg-name:"PASSWORD" description:"the password, read from standard input when absent; an argument stays in ps and the shell history"`
	} `positional-args:"yes"`
}

type tokenOptions struct {
	Args struct {
		Name string `positional-arg-name:"NAME" description:"the name the token's requests are recorded under, bot when absent"`
	} `positional-args:"yes"`
}

// formatTimeout bounds one run of prettier from the command line. The server
// keeps its own; here the caller sees the error and can try a smaller file.
const formatTimeout = time.Minute

// runCommand runs one command line and returns the exit code.
func runCommand(args []string, in io.Reader, out, errOut io.Writer) int {
	cmds, name, err := parseCommands(args)
	if err != nil {
		var flagsErr *flags.Error
		if errors.As(err, &flagsErr) && flagsErr.Type == flags.ErrHelp {
			_, _ = fmt.Fprintln(out, flagsErr.Message)
			_, _ = fmt.Fprint(out, helpFooter(name))
			return 0
		}
		_, _ = fmt.Fprintln(errOut, err)
		return failureCode(name)
	}
	if cmds.Version {
		_, _ = fmt.Fprintf(out, "scrawl %s\n", versionInfo())
		return 0
	}
	if name == serveCommand {
		return runServe(&cmds.Serve)
	}

	// diff and format have an exit code of their own beyond failing
	code := 0
	tools := map[string]func() error{
		renderCommand: func() error { return runRender(&cmds.Render, in, out) },
		siteCommand:   func() error { return runSite(&cmds.Site, out) },
		diffCommand: func() (runErr error) {
			code, runErr = runDiff(&cmds.Diff, out)
			return runErr
		},
		formatCommand: func() (runErr error) {
			code, runErr = runFormat(&cmds.Format, in, out)
			return runErr
		},
		styleCommand: func() error { return writeText(out, page.Stylesheet()) },
		hashCommand: func() error {
			hash, hashErr := genHash(cmds.Hash.Args.Password, in)
			if hashErr != nil {
				return hashErr
			}
			return writeText(out, hash+"\n")
		},
		tokenCommand: func() error { return writeText(out, genToken(orDefault(cmds.Token.Args.Name, "bot"))+"\n") },
	}
	tool, ok := tools[name]
	if !ok {
		_, _ = fmt.Fprintf(errOut, "a command is required: %s; see scrawl --help\n", strings.Join(commandNames(), ", "))
		return 1
	}

	setupLog(false)
	if err = tool(); err != nil {
		_, _ = fmt.Fprintf(errOut, "scrawl %s: %v\n", name, err)
		return failureCode(name)
	}
	return code
}

// failureCode is the exit code of a command that failed. git diff's convention:
// 1 is "there are differences", so a failure of diff has to be something else.
func failureCode(name string) int {
	if name == diffCommand {
		return 2
	}
	return 1
}

func writeText(out io.Writer, text string) error {
	if _, err := io.WriteString(out, text); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	return nil
}

// parseCommands reads a command line. Whatever follows "--" is never an option:
// for diff it is the paths the comparison is limited to, the way git takes
// them, and for every other command it is more files.
func parseCommands(args []string) (*commands, string, error) {
	head, tail := args, []string(nil)
	if at := slices.Index(args, "--"); at >= 0 {
		head, tail = args[:at], args[at+1:]
	}

	var cmds commands
	p := flags.NewParser(&cmds, flags.HelpFlag)
	p.SubcommandsOptional = true
	for _, cmd := range p.Commands() {
		cmd.LongDescription = sentence(cmd.ShortDescription)
	}
	rest, err := p.ParseArgs(head)
	name := ""
	if p.Active != nil {
		name = p.Active.Name
	}
	if err != nil {
		return nil, name, fmt.Errorf("parse flags: %w", err)
	}
	if len(rest) > 0 {
		return nil, "", fmt.Errorf("parse flags: unknown command or argument %q", rest[0])
	}

	switch name {
	case diffCommand:
		cmds.Diff.paths = tail
	case renderCommand:
		if len(tail) > 0 {
			if cmds.Render.Args.File != "" || len(tail) > 1 {
				return nil, "", errors.New("parse flags: render takes one file")
			}
			cmds.Render.Args.File = tail[0]
		}
	case formatCommand:
		cmds.Format.Args.Files = append(cmds.Format.Args.Files, tail...)
	default:
		if len(tail) > 0 {
			return nil, "", fmt.Errorf("parse flags: unexpected arguments: %s", strings.Join(tail, " "))
		}
	}
	return &cmds, name, nil
}

func commandNames() []string {
	return []string{serveCommand, renderCommand, siteCommand, diffCommand, formatCommand, styleCommand, hashCommand, tokenCommand}
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// newCLIRenderer is the renderer of every command but serve: a relative link
// stays relative, because outside the app there is no route to map it onto.
// pageOptions is what a page of render or diff carries beyond the note.
func (o outputOptions) pageOptions() page.Options {
	return page.Options{Math: o.Math}
}

func newCLIRenderer(opts outputOptions) *render.Renderer {
	return render.New(render.Options{Relative: true, PageExt: opts.LinkExt})
}

// noteJSON is a rendered note as `render --format json` answers it.
type noteJSON struct {
	Title       string           `json:"title"`
	HTML        string           `json:"html"`
	TOC         []render.Heading `json:"toc"`
	Frontmatter string           `json:"frontmatter,omitempty"`
}

func runRender(opts *renderOptions, in io.Reader, out io.Writer) error {
	name, src, err := readInput(opts.Args.File, in)
	if err != nil {
		return err
	}
	res, err := newCLIRenderer(opts.outputOptions).Render(src, name)
	if err != nil {
		return fmt.Errorf("render %s: %w", name, err)
	}

	var buf bytes.Buffer
	switch opts.Format {
	case outputJSON:
		err = writeJSONTo(&buf, noteJSON{
			Title: res.Title, HTML: string(res.HTML), TOC: res.TOC, Frontmatter: render.Frontmatter(src),
		})
	case outputFragment:
		buf.WriteString(string(res.HTML))
	default:
		err = page.WriteNote(&buf, page.Note{Title: res.Title, HTML: string(res.HTML)}, opts.pageOptions())
	}
	if err != nil {
		return err
	}
	return writeOutput(opts.Output, buf.Bytes(), out)
}

// readInput reads a file, or standard input for "" and "-", and names it the
// way the renderer wants a document named.
func readInput(file string, in io.Reader) (string, []byte, error) {
	if file == "" || file == "-" {
		data, err := io.ReadAll(in)
		if err != nil {
			return "", nil, fmt.Errorf("read standard input: %w", err)
		}
		return "stdin.md", data, nil
	}
	data, err := os.ReadFile(file) //nolint:gosec // a file the caller named on its own command line
	if err != nil {
		return "", nil, fmt.Errorf("read %s: %w", file, err)
	}
	return filepath.ToSlash(filepath.Base(file)), data, nil
}

// writeOutput writes to the file the caller named, or to out.
func writeOutput(file string, data []byte, out io.Writer) error {
	if file == "" || file == "-" {
		if _, err := out.Write(data); err != nil {
			return fmt.Errorf("write: %w", err)
		}
		return nil
	}
	if err := os.WriteFile(file, data, 0o644); err != nil { //nolint:gosec // a page meant to be read
		return fmt.Errorf("write %s: %w", file, err)
	}
	return nil
}

func writeJSONTo(w io.Writer, value any) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(value); err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	return nil
}

// runFormat formats every file it is given, or standard input, with the same
// prettier a save in the app goes through. The exit code is 1 when --check
// found a file that would change.
func runFormat(opts *formatOptions, in io.Reader, out io.Writer) (int, error) {
	files, err := formatTargets(opts)
	if err != nil {
		return 0, err
	}
	formatter := format.New(1)
	defer formatter.Close()

	code := 0
	for _, file := range files {
		_, src, readErr := readInput(file, in)
		if readErr != nil {
			return 0, readErr
		}
		ctx, cancel := context.WithTimeout(context.Background(), formatTimeout)
		formatted, fmtErr := formatter.Markdown(ctx, string(src))
		cancel()
		if fmtErr != nil {
			return 0, fmt.Errorf("%s: %w", file, fmtErr)
		}
		changed := formatted != string(src)
		switch {
		case opts.Check && changed:
			code = 1
			err = writeText(out, file+"\n")
		case opts.Write && changed:
			err = writeInPlace(file, []byte(formatted))
		case !opts.Check && !opts.Write:
			err = writeText(out, formatted)
		}
		if err != nil {
			return 0, err
		}
	}
	return code, nil
}

// formatTargets is the files a format run reads, "-" for standard input,
// refusing the combinations that would print several notes as one.
func formatTargets(opts *formatOptions) ([]string, error) {
	if opts.Write && opts.Check {
		return nil, errors.New("--write and --check exclude each other")
	}
	files := opts.Args.Files
	if len(files) == 0 {
		files = []string{"-"}
	}
	if slices.Contains(files, "-") && (opts.Write || len(files) > 1) {
		return nil, errors.New("standard input can only be formatted alone, and never with --write")
	}
	if len(files) > 1 && !opts.Write && !opts.Check {
		return nil, errors.New("several files need --write or --check")
	}
	return files, nil
}

// writeInPlace replaces a file the way the store does: a temporary file beside
// it, then a rename, so an interrupted run never leaves half a note behind.
func writeInPlace(file string, data []byte) error {
	info, err := os.Stat(file)
	if err != nil {
		return fmt.Errorf("write %s: %w", file, err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), "."+filepath.Base(file)+".*")
	if err != nil {
		return fmt.Errorf("write %s: %w", file, err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write %s: %w", file, err)
	}
	if err := tmp.Chmod(info.Mode().Perm()); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write %s: %w", file, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("write %s: %w", file, err)
	}
	if err := os.Rename(tmp.Name(), file); err != nil {
		return fmt.Errorf("write %s: %w", file, err)
	}
	return nil
}
