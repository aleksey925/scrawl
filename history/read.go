package history

import (
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const logSentinel = "COMMIT"

const logFormat = "COMMIT%x00%H%x00%an%x00%at%x00%s"

const logFieldCount = 5

const shortLen = 8

type Kind string

const (
	KindAdded    Kind = "added"
	KindModified Kind = "modified"
	KindRenamed  Kind = "renamed"
	KindDeleted  Kind = "deleted"
)

type Entry struct {
	Rev, Short, Blob, Actor, Message string
	Path                             string
	Kind                             Kind
	At                               time.Time
}

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

type Change struct {
	Before, After string
	From          string
}

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
		"--no-ext-diff", "--no-textconv", "--no-color",
		rev, "--", cleaned,
	}
	out, err := s.run(ctx, command{args: args, limit: maxDiffBytes})
	if err != nil {
		return "", fmt.Errorf("history: diff %s %q: %w", rev, cleaned, err)
	}
	return string(out), nil
}

func parseLog(out []byte) ([]Entry, error) {
	res := []Entry{}
	rest := out
	for len(rest) > 0 {
		fields, rows, tail, err := nextRecord(rest)
		if err != nil {
			return nil, err
		}
		rest = tail
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

func firstRecord(out []byte) ([]string, []rawRow, error) {
	if len(out) == 0 {
		return nil, nil, nil
	}
	fields, rows, _, err := nextRecord(out)
	return fields, rows, err
}

type rawRow struct {
	srcBlob string
	blob    string
	status  string
	from    string
	path    string
}

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

func nonZero(oid string) string {
	if strings.Trim(oid, "0") == "" {
		return ""
	}
	return oid
}
