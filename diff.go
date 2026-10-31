package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/aleksey925/scrawl/htmldiff"
	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/render"
)

type diffOptions struct {
	outputOptions
	Context  int    `long:"context" default:"1" description:"unchanged blocks kept in sight around each change"`
	Layout   string `long:"layout" default:"split" choice:"split" choice:"unified" description:"the two versions side by side, or the note once with the changes marked in it"`
	ExitCode bool   `long:"exit-code" description:"exit with 1 when the text changed, the way git diff --exit-code does"`
	Args     struct {
		Revs []string `positional-arg-name:"REV" description:"two markdown files, or revisions the way git diff takes them; paths go after --"`
	} `positional-args:"yes"`

	paths []string
}

const workingTree = "working tree"

type diffFileJSON struct {
	Path    string         `json:"path"`
	OldPath string         `json:"old_path,omitempty"`
	Status  page.Status    `json:"status"`
	Stats   htmldiff.Stats `json:"stats"`
	Rows    []htmldiff.Row `json:"rows"`
}

type diffJSON struct {
	Old   string         `json:"old"`
	New   string         `json:"new"`
	Files []diffFileJSON `json:"files"`
}

func runDiff(opts *diffOptions, out io.Writer) (int, error) {
	if opts.Context < 0 {
		return 0, errors.New("--context must not be negative")
	}
	cmp, err := collect(context.Background(), opts.Args.Revs, opts.paths)
	if err != nil {
		return 0, err
	}
	rep, err := buildReport(newCLIRenderer(opts.outputOptions), cmp, opts.Context)
	if err != nil {
		return 0, err
	}
	rep.Layout = page.Layout(opts.Layout)

	var buf bytes.Buffer
	switch opts.Format {
	case outputJSON:
		err = writeJSONTo(&buf, reportJSON(cmp.oldLabel, cmp.newLabel, rep))
	case outputFragment:
		err = page.WriteDiffFragment(&buf, rep)
	default:
		err = page.WriteDiff(&buf, rep, opts.pageOptions())
	}
	if err != nil {
		return 0, err
	}
	if err := writeOutput(opts.Output, buf.Bytes(), out); err != nil {
		return 0, err
	}
	if opts.ExitCode && anyChange(rep) {
		return 1, nil
	}
	return 0, nil
}

type comparison struct {
	oldLabel, newLabel string
	files              []sides
}

func collect(ctx context.Context, revs, paths []string) (comparison, error) {
	if len(revs) == 2 && len(paths) == 0 && isFile(revs[0]) && isFile(revs[1]) {
		files, err := fileSides(revs[0], revs[1])
		return comparison{oldLabel: revs[0], newLabel: revs[1], files: files}, err
	}
	repo, err := openRepo(ctx)
	if err != nil {
		return comparison{}, err
	}
	rng, err := repo.resolve(ctx, revs)
	if err != nil {
		return comparison{}, err
	}
	files, err := repo.sides(ctx, rng, paths)
	return comparison{oldLabel: rng.oldLabel, newLabel: rng.newLabel, files: files}, err
}

func buildReport(renderer *render.Renderer, cmp comparison, around int) (page.Report, error) {
	rep := page.Report{Title: cmp.oldLabel + " → " + cmp.newLabel, Context: around}
	for _, sd := range cmp.files {
		rows, err := compareSides(renderer, sd)
		if err != nil {
			return page.Report{}, err
		}
		file := page.File{
			Path: sd.path(), Status: sd.status, Rows: rows,
			OldLabel: labelOr(sd.old != nil, cmp.oldLabel), NewLabel: labelOr(sd.cur != nil, cmp.newLabel),
		}
		if sd.status == page.Renamed {
			file.OldPath = sd.oldPath
		}
		rep.Files = append(rep.Files, file)
	}
	return rep, nil
}

func anyChange(rep page.Report) bool {
	for _, file := range rep.Files {
		if !file.Stats().Empty() {
			return true
		}
	}
	return false
}

func labelOr(present bool, label string) string {
	if !present {
		return "-"
	}
	return label
}

func reportJSON(oldLabel, newLabel string, rep page.Report) diffJSON {
	res := diffJSON{Old: oldLabel, New: newLabel, Files: make([]diffFileJSON, 0, len(rep.Files))}
	for _, file := range rep.Files {
		res.Files = append(res.Files, diffFileJSON{
			Path: file.Path, OldPath: file.OldPath, Status: file.Status, Stats: file.Stats(), Rows: file.Rows,
		})
	}
	return res
}

type sides struct {
	status  page.Status
	oldPath string
	newPath string
	old     []byte
	cur     []byte
}

func (s sides) path() string {
	if s.newPath != "" {
		return s.newPath
	}
	return s.oldPath
}

func compareSides(renderer *render.Renderer, sd sides) ([]htmldiff.Row, error) {
	oldDoc, err := renderSide(renderer, sd.oldPath, sd.old)
	if err != nil {
		return nil, err
	}
	curDoc, err := renderSide(renderer, sd.newPath, sd.cur)
	if err != nil {
		return nil, err
	}
	rows, err := htmldiff.Diff(oldDoc, curDoc)
	if err != nil {
		return nil, fmt.Errorf("compare %s: %w", sd.path(), err)
	}
	return rows, nil
}

func renderSide(renderer *render.Renderer, docPath string, src []byte) (htmldiff.Document, error) {
	if src == nil {
		return htmldiff.Document{}, nil
	}
	res, err := renderer.Render(src, docPath)
	if err != nil {
		return htmldiff.Document{}, fmt.Errorf("render %s: %w", docPath, err)
	}
	return htmldiff.Document{Frontmatter: render.Frontmatter(src), HTML: string(res.HTML)}, nil
}

func isFile(name string) bool {
	info, err := os.Stat(name)
	return err == nil && info.Mode().IsRegular()
}

func fileSides(oldFile, newFile string) ([]sides, error) {
	old, err := os.ReadFile(oldFile) //nolint:gosec // a file the caller named on its own command line
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", oldFile, err)
	}
	cur, err := os.ReadFile(newFile) //nolint:gosec // a file the caller named on its own command line
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", newFile, err)
	}
	return []sides{{
		status: page.Modified, oldPath: filepath.ToSlash(oldFile), newPath: filepath.ToSlash(newFile),
		old: old, cur: cur,
	}}, nil
}

type gitRepo struct {
	top string
	cwd string
}

type revRange struct {
	oldRev, newRev     string
	oldLabel, newLabel string
}

func openRepo(ctx context.Context) (*gitRepo, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("working directory: %w", err)
	}
	repo := &gitRepo{cwd: cwd}
	out, err := repo.git(ctx, "rev-parse", "--show-toplevel")
	if err != nil {
		return nil, fmt.Errorf("not two markdown files and not inside a git repository: %w", err)
	}
	repo.top = strings.TrimSpace(string(out))
	return repo, nil
}

func (r *gitRepo) git(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = r.top
	if cmd.Dir == "" {
		cmd.Dir = r.cwd
	}
	cmd.Env = append(os.Environ(), "LC_ALL=C", "GIT_TERMINAL_PROMPT=0")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimPrefix(strings.TrimSpace(stderr.String()), "fatal: ")
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("git %s: %s", args[0], msg)
	}
	return out, nil
}

var reOID = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

func (r *gitRepo) resolve(ctx context.Context, revs []string) (revRange, error) {
	label := func(rev string) string {
		if reOID.MatchString(rev) {
			return rev[:8]
		}
		return rev
	}
	for _, rev := range revs {
		if strings.HasPrefix(rev, "-") {
			return revRange{}, fmt.Errorf("%q is not a revision", rev)
		}
	}
	switch len(revs) {
	case 0:
		return revRange{oldRev: "HEAD", oldLabel: "HEAD", newLabel: workingTree}, nil
	case 1:
		rev := revs[0]
		if a, b, ok := strings.Cut(rev, "..."); ok {
			a, b = orDefault(a, "HEAD"), orDefault(b, "HEAD")
			out, err := r.git(ctx, "merge-base", a, b)
			if err != nil {
				return revRange{}, err
			}
			return revRange{
				oldRev: strings.TrimSpace(string(out)), newRev: b,
				oldLabel: label(a) + " (merge base)", newLabel: label(b),
			}, nil
		}
		if a, b, ok := strings.Cut(rev, ".."); ok {
			a, b = orDefault(a, "HEAD"), orDefault(b, "HEAD")
			return revRange{oldRev: a, newRev: b, oldLabel: label(a), newLabel: label(b)}, nil
		}
		return revRange{oldRev: rev, oldLabel: label(rev), newLabel: workingTree}, nil
	case 2:
		return revRange{oldRev: revs[0], newRev: revs[1], oldLabel: label(revs[0]), newLabel: label(revs[1])}, nil
	default:
		return revRange{}, errors.New("at most two revisions; paths go after --")
	}
}

func (r *gitRepo) sides(ctx context.Context, rng revRange, paths []string) ([]sides, error) {
	for _, rev := range []string{rng.oldRev, rng.newRev} {
		if rev == "" {
			continue
		}
		if _, err := r.git(ctx, "rev-parse", "--verify", "--quiet", "--end-of-options", rev+"^{commit}"); err != nil {
			return nil, fmt.Errorf("%q is not a revision", rev)
		}
	}
	specs, err := r.pathspecs(paths)
	if err != nil {
		return nil, err
	}

	args := []string{"diff", "-z", "--name-status", "-M", "--no-ext-diff", "--no-textconv", rng.oldRev}
	if rng.newRev != "" {
		args = append(args, rng.newRev)
	}
	out, err := r.git(ctx, append(append(args, "--"), specs...)...)
	if err != nil {
		return nil, err
	}
	changes, err := parseNameStatus(out)
	if err != nil {
		return nil, err
	}
	if rng.newRev == "" {
		untracked, lsErr := r.git(ctx, append([]string{"ls-files", "-z", "--others", "--exclude-standard", "--"}, specs...)...)
		if lsErr != nil {
			return nil, lsErr
		}
		for _, p := range nulSplit(untracked) {
			changes = append(changes, sides{status: page.Added, newPath: p})
		}
	}

	res := []sides{}
	for _, sd := range changes {
		if !isMarkdown(sd.oldPath) && !isMarkdown(sd.newPath) {
			continue
		}
		if err := r.read(ctx, rng, &sd); err != nil {
			return nil, err
		}
		res = append(res, sd)
	}
	sort.Slice(res, func(i, j int) bool { return res[i].path() < res[j].path() })
	return res, nil
}

func (r *gitRepo) pathspecs(paths []string) ([]string, error) {
	res := make([]string, 0, len(paths))
	for _, p := range paths {
		abs := p
		if !filepath.IsAbs(abs) {
			abs = filepath.Join(r.cwd, p)
		}
		rel, err := filepath.Rel(r.top, abs)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("%s is outside the repository", p)
		}
		res = append(res, ":(literal)"+filepath.ToSlash(rel))
	}
	return res, nil
}

func (r *gitRepo) read(ctx context.Context, rng revRange, sd *sides) error {
	if sd.oldPath != "" {
		data, err := r.git(ctx, "cat-file", "blob", rng.oldRev+":"+sd.oldPath)
		if err != nil {
			return err
		}
		sd.old = data
	}
	if sd.newPath == "" {
		return nil
	}
	if rng.newRev != "" {
		data, err := r.git(ctx, "cat-file", "blob", rng.newRev+":"+sd.newPath)
		if err != nil {
			return err
		}
		sd.cur = data
		return nil
	}
	root, err := os.OpenRoot(r.top)
	if err != nil {
		return fmt.Errorf("open %s: %w", r.top, err)
	}
	defer func() { _ = root.Close() }()
	data, err := root.ReadFile(filepath.FromSlash(sd.newPath))
	if err != nil {
		return fmt.Errorf("read %s: %w", sd.newPath, err)
	}
	sd.cur = data
	return nil
}

func parseNameStatus(out []byte) ([]sides, error) {
	fields := nulSplit(out)
	res := []sides{}
	for i := 0; i < len(fields); {
		status := fields[i]
		if status == "" {
			return nil, errors.New("git diff: an empty status")
		}
		switch status[0] {
		case 'R', 'C':
			if i+2 >= len(fields) {
				return nil, fmt.Errorf("git diff: %s without both paths", status)
			}
			sd := sides{status: page.Renamed, oldPath: fields[i+1], newPath: fields[i+2]}
			if status[0] == 'C' {
				sd = sides{status: page.Added, newPath: fields[i+2]}
			}
			res = append(res, sd)
			i += 3
		default:
			if i+1 >= len(fields) {
				return nil, fmt.Errorf("git diff: %s without a path", status)
			}
			p := fields[i+1]
			switch status[0] {
			case 'A':
				res = append(res, sides{status: page.Added, newPath: p})
			case 'D':
				res = append(res, sides{status: page.Deleted, oldPath: p})
			default:
				res = append(res, sides{status: page.Modified, oldPath: p, newPath: p})
			}
			i += 2
		}
	}
	return res, nil
}

func nulSplit(out []byte) []string {
	res := []string{}
	for field := range strings.SplitSeq(string(out), "\x00") {
		if field != "" {
			res = append(res, field)
		}
	}
	return res
}

func isMarkdown(p string) bool { return p != "" && strings.EqualFold(path.Ext(p), ".md") }
