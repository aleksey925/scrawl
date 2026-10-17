package history

import (
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// logSentinel opens every record of the log output. The records are consumed by
// position and never searched for, so a note actually named "COMMIT" is just a
// path like any other.
const logSentinel = "COMMIT"

// logFormat yields sentinel, hash, author, epoch and subject, each
// NUL-terminated, followed by the raw change rows of that commit.
const logFormat = "COMMIT%x00%H%x00%an%x00%at%x00%s"

const logFieldCount = 5

// shortLen is how much of an object id identifies a version on the page. The
// log runs with --no-abbrev so that the raw rows carry blob ids in full, and
// that flag applies to git's own %h as well, which is why the short form is cut
// here rather than asked for in the format.
const shortLen = 8

// Kind is what happened to a document in one commit.
type Kind string

// The change kinds a log entry can carry.
const (
	KindAdded    Kind = "added"
	KindModified Kind = "modified"
	KindRenamed  Kind = "renamed"
	KindDeleted  Kind = "deleted"
)

// Entry is one version of a document.
//
// Path is where the document lived at that commit, which is not where it lives
// now once it has been renamed, and Blob is the content git stored for it.
// Reading a version goes through the blob for that reason: asking for a path
// against an older revision fails as soon as a rename sits in between. A
// deletion has no content and carries an empty Blob.
type Entry struct {
	Rev, Short, Blob, Actor, Message string
	Path                             string
	Kind                             Kind
	At                               time.Time
}

// Log lists the versions of a document, newest first, following it through
// renames. A path that history never held and an empty repository both give an
// empty list rather than an error. A limit of zero or less means the default.
func (s *Service) Log(ctx context.Context, p string, limit int) ([]Entry, error) {
	if s == nil {
		return nil, ErrDisabled
	}
	cleaned, err := cleanPath(p)
	if err != nil {
		return nil, fmt.Errorf("history: log: %w", err)
	}
	if !s.hasHead(ctx) {
		return []Entry{}, nil
	}
	if limit <= 0 {
		limit = defaultLogLimit
	}

	args := []string{
		"log", "--follow", "--raw", "--no-abbrev", "-z", "--no-color",
		"--format=" + logFormat, "-n", strconv.Itoa(limit), "--", cleaned,
	}
	out, err := s.run(ctx, command{args: args})
	if err != nil {
		return nil, fmt.Errorf("history: log %q: %w", cleaned, err)
	}
	entries, err := parseLog(out)
	if err != nil {
		return nil, fmt.Errorf("history: log %q: %w", cleaned, err)
	}
	return entries, nil
}

// Version resolves the blob one commit recorded for one path, which is how a
// caller comes by a blob at all. The pair has to be exactly a commit and a path
// that commit changed, the way a log entry carries them, so that a blob named
// from outside cannot be read back under a path it never belonged to.
//
// log walks backwards, so a commit that left the path alone answers with an
// older one instead of nothing, and only the commit that was asked for is the
// version that was asked for. A commit that deleted the path recorded no
// content and resolves to an empty blob.
func (s *Service) Version(ctx context.Context, rev, p string) (string, error) {
	if s == nil {
		return "", ErrDisabled
	}
	if !isOID(rev) {
		return "", fmt.Errorf("history: version: %q is not an object id", rev)
	}
	cleaned, err := cleanPath(p)
	if err != nil {
		return "", fmt.Errorf("history: version: %w", err)
	}

	args := []string{
		"log", "-n", "1", "--raw", "--no-abbrev", "-z", "--no-color",
		"--format=" + logFormat, rev, "--", cleaned,
	}
	out, err := s.run(ctx, command{args: args})
	if err != nil {
		return "", fmt.Errorf("history: version %s %q: %w", rev, cleaned, err)
	}
	entries, err := parseLog(out)
	if err != nil {
		return "", fmt.Errorf("history: version %s %q: %w", rev, cleaned, err)
	}
	if len(entries) == 0 || entries[0].Rev != rev {
		return "", fmt.Errorf("history: version %s %q: %w", rev, cleaned, ErrNoVersion)
	}
	return entries[0].Blob, nil
}

// Change is what one commit did to one document: the blob before and the blob
// after, either empty where the document did not exist, and the path it had
// before, which is not the path it has after a rename.
type Change struct {
	Before, After string
	From          string
}

// Change resolves the pair of blobs one commit changed one path between, held
// to the same pair Version is: a commit and a path that commit changed. It
// follows the path through a rename, which is the one way the version before
// lived under another name. A copy is not followed: the copy is a new document,
// and what it was copied from is not a version of it.
func (s *Service) Change(ctx context.Context, rev, p string) (Change, error) {
	if s == nil {
		return Change{}, ErrDisabled
	}
	if !isOID(rev) {
		return Change{}, fmt.Errorf("history: change: %q is not an object id", rev)
	}
	cleaned, err := cleanPath(p)
	if err != nil {
		return Change{}, fmt.Errorf("history: change: %w", err)
	}

	args := []string{
		"log", "-n", "1", "--follow", "--raw", "--no-abbrev", "-z", "--no-color",
		"--format=" + logFormat, rev, "--", cleaned,
	}
	out, err := s.run(ctx, command{args: args})
	if err != nil {
		return Change{}, fmt.Errorf("history: change %s %q: %w", rev, cleaned, err)
	}
	fields, rows, err := firstRecord(out)
	if err != nil {
		return Change{}, fmt.Errorf("history: change %s %q: %w", rev, cleaned, err)
	}
	if len(rows) == 0 || fields[1] != rev {
		return Change{}, fmt.Errorf("history: change %s %q: %w", rev, cleaned, ErrNoVersion)
	}
	row := rows[0]
	res := Change{After: nonZero(row.blob), From: row.path}
	if kindOf(row.status) != KindAdded {
		res.Before = nonZero(row.srcBlob)
	}
	if kindOf(row.status) == KindRenamed {
		res.From = row.from
	}
	return res, nil
}

// Show returns the bytes git stored for a version. It takes the blob of an
// Entry, never a revision and a path: after a rename the path does not exist at
// the older revision and git refuses to resolve it.
func (s *Service) Show(ctx context.Context, blob string) ([]byte, error) {
	if s == nil {
		return nil, ErrDisabled
	}
	if !isOID(blob) {
		return nil, fmt.Errorf("history: show: %q is not an object id", blob)
	}
	out, err := s.run(ctx, command{args: []string{"cat-file", "blob", blob}, limit: maxBlobBytes})
	if err != nil {
		return nil, fmt.Errorf("history: show %s: %w", blob, err)
	}
	return out, nil
}

// Diff returns the patch one commit made to one document. The path is the
// historical one, as carried by the Entry, and p being restricted to a single
// document is why the patch shows a rename as an addition: the other half of
// the pair is outside the pathspec.
//
// diff-tree with --root is what makes this work on the very first commit too,
// where there is no parent for git to diff against.
func (s *Service) Diff(ctx context.Context, rev, p string) (string, error) {
	if s == nil {
		return "", ErrDisabled
	}
	if !isOID(rev) {
		return "", fmt.Errorf("history: diff: %q is not an object id", rev)
	}
	cleaned, err := cleanPath(p)
	if err != nil {
		return "", fmt.Errorf("history: diff: %w", err)
	}
	args := []string{
		"diff-tree", "--root", "--no-commit-id", "-r", "-M", "-p",
		// a diff driver and a textconv filter are both commands the repository
		// gets to name, and this repository is not necessarily ours
		"--no-ext-diff", "--no-textconv", "--no-color",
		rev, "--", cleaned,
	}
	out, err := s.run(ctx, command{args: args, limit: maxDiffBytes})
	if err != nil {
		return "", fmt.Errorf("history: diff %s %q: %w", rev, cleaned, err)
	}
	return string(out), nil
}

// parseLog reads the output of the log command above. Records are consumed by
// position: the fixed header first, then every raw row that follows it, which
// is what keeps a path holding a newline, a colon or the sentinel itself from
// being mistaken for a delimiter.
func parseLog(out []byte) ([]Entry, error) {
	res := []Entry{}
	rest := out
	for len(rest) > 0 {
		fields, rows, tail, err := nextRecord(rest)
		if err != nil {
			return nil, err
		}
		rest = tail
		// a commit that changed nothing under the path - a merge is the usual
		// one - has no version to offer
		if len(rows) == 0 {
			continue
		}
		entry, err := entryOf(fields, rows[0])
		if err != nil {
			return nil, err
		}
		res = append(res, entry)
	}
	return res, nil
}

// nextRecord splits the first commit off the log output: its header fields
// and its change rows.
func nextRecord(in []byte) (fields []string, rows []rawRow, rest []byte, err error) {
	fields, rest, err = nulFields(in, logFieldCount)
	if err != nil {
		return nil, nil, nil, err
	}
	if fields[0] != logSentinel {
		return nil, nil, nil, fmt.Errorf("unexpected record %q", fields[0])
	}
	rows, rest, err = parseRows(rest)
	if err != nil {
		return nil, nil, nil, err
	}
	return fields, rows, rest, nil
}

// firstRecord reads the one commit a log limited to one prints, and nothing
// at all from a log that found none.
func firstRecord(out []byte) ([]string, []rawRow, error) {
	if len(out) == 0 {
		return nil, nil, nil
	}
	fields, rows, _, err := nextRecord(out)
	return fields, rows, err
}

// rawRow is one line of --raw output: the pre- and post-image blobs, the status
// letter, the path the change landed on and, for a rename or a copy, the path it
// came from.
type rawRow struct {
	srcBlob string
	blob    string
	status  string
	from    string
	path    string
}

// parseRows consumes the change rows of one commit. They are separated from the
// header by a newline and from each other by nothing at all.
func parseRows(in []byte) ([]rawRow, []byte, error) {
	res := []rawRow{}
	rest := in
	for {
		rest = bytes.TrimLeft(rest, "\n")
		if len(rest) == 0 || rest[0] != ':' {
			return res, rest, nil
		}
		row, tail, err := parseRow(rest)
		if err != nil {
			return nil, nil, err
		}
		res = append(res, row)
		rest = tail
	}
}

// parseRow reads ":<srcmode> <dstmode> <srcsha> <dstsha> <status>" and the one
// or two paths behind it. A rename and a copy name both sides, everything else
// names one, and the status carries a similarity score that is not part of the
// letter.
func parseRow(in []byte) (rawRow, []byte, error) {
	head, rest, err := nulFields(in, 1)
	if err != nil {
		return rawRow{}, nil, err
	}
	meta := strings.Fields(head[0])
	if len(meta) != 5 {
		return rawRow{}, nil, fmt.Errorf("unexpected change row %q", head[0])
	}
	status := meta[4]
	names := 1
	if status[0] == 'R' || status[0] == 'C' {
		names = 2
	}
	paths, rest, err := nulFields(rest, names)
	if err != nil {
		return rawRow{}, nil, err
	}
	return rawRow{srcBlob: meta[2], blob: meta[3], status: status, from: paths[0], path: paths[len(paths)-1]}, rest, nil
}

func entryOf(fields []string, row rawRow) (Entry, error) {
	at, err := strconv.ParseInt(fields[3], 10, 64)
	if err != nil {
		return Entry{}, fmt.Errorf("unexpected timestamp %q: %w", fields[3], err)
	}
	blob := nonZero(row.blob)
	return Entry{
		Rev:     fields[1],
		Short:   shortOID(fields[1]),
		Blob:    blob,
		Actor:   fields[2],
		Message: fields[4],
		Path:    row.path,
		Kind:    kindOf(row.status),
		At:      time.Unix(at, 0),
	}, nil
}

func shortOID(rev string) string {
	if len(rev) <= shortLen {
		return rev
	}
	return rev[:shortLen]
}

func kindOf(status string) Kind {
	switch status[0] {
	case 'A', 'C':
		return KindAdded
	case 'D':
		return KindDeleted
	case 'R':
		return KindRenamed
	default:
		return KindModified
	}
}

// nulFields splits off n NUL-terminated fields and returns what is left.
func nulFields(in []byte, n int) ([]string, []byte, error) {
	res, rest := make([]string, 0, n), in
	for range n {
		end := bytes.IndexByte(rest, 0)
		if end < 0 {
			return nil, nil, fmt.Errorf("truncated record, wanted %d fields, got %d", n, len(res))
		}
		res = append(res, string(rest[:end]))
		rest = rest[end+1:]
	}
	return res, rest, nil
}

func isOID(s string) bool {
	if len(s) != 40 && len(s) != 64 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// nonZero is an object id, or "" for the all-zero one git writes for a side
// that does not exist.
func nonZero(oid string) string {
	if strings.Trim(oid, "0") == "" {
		return ""
	}
	return oid
}
