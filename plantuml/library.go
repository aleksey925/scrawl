package plantuml

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/aleksey925/scrawl/gzassets"
)

var ErrNoLibrary = errors.New("no such plantuml library")

var library = gzassets.Sub(libraryFiles, "library")

const (
	bundleSuffix = ".min.js"
	themesFile   = "themes.js"
	iconsFile    = "openiconic.js"
	emojiFile    = "emoji.js"
)

var (
	libraryName = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*\.js$`)
	includedLib = regexp.MustCompile(`!(?:include\w*|import)\s*<([A-Za-z0-9][A-Za-z0-9._-]*)/`)
	linkedLib   = regexp.MustCompile(`link:"([A-Za-z0-9][A-Za-z0-9._-]*)"`)
)

var extraLibraries = []struct {
	pattern *regexp.Regexp
	file    string
}{
	{pattern: regexp.MustCompile(`(?m)^\s*!theme\s`), file: themesFile},
	{pattern: regexp.MustCompile(`<(?:#\w+)?&[\w-]+`), file: iconsFile},
	{pattern: regexp.MustCompile(`<(?:#\w+)?:[\w+-]+:`), file: emojiFile},
}

func LibraryFile(name string) ([]byte, error) {
	if !libraryName.MatchString(name) || !library.Has(name) {
		return nil, fmt.Errorf("%s: %w", name, ErrNoLibrary)
	}
	return library.ReadFile(name)
}

func ServeLibrary(w http.ResponseWriter, r *http.Request, name string) {
	if !libraryName.MatchString(name) || !library.Has(name) {
		http.NotFound(w, r)
		return
	}
	library.ServeFile(w, r, name)
}

func bundleOf(lib string) string {
	return strings.ToLower(lib) + bundleSuffix
}

func Libraries(src []byte) []string {
	matches := includedLib.FindAllSubmatch(src, -1)
	res := make([]string, 0, len(matches)+len(extraLibraries))
	for _, match := range matches {
		res = append(res, bundleOf(string(match[1])))
	}
	for _, extra := range extraLibraries {
		if extra.pattern.Match(src) {
			res = append(res, extra.file)
		}
	}
	slices.Sort(res)
	return slices.Compact(res)
}

func WithDependencies(names []string) ([]string, error) {
	seen := map[string]bool{}
	queue := slices.Clone(names)
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if seen[name] {
			continue
		}
		code, err := LibraryFile(name)
		if errors.Is(err, ErrNoLibrary) {
			continue
		}
		if err != nil {
			return nil, err
		}
		seen[name] = true
		for _, match := range includedLib.FindAllSubmatch(code, -1) {
			queue = append(queue, bundleOf(string(match[1])))
		}
		for _, match := range linkedLib.FindAllSubmatch(code, -1) {
			queue = append(queue, bundleOf(string(match[1])))
		}
		if bytes.Contains(code, []byte("!theme")) {
			queue = append(queue, themesFile)
		}
		if strings.HasSuffix(name, bundleSuffix) {
			queue = append(queue, iconsFile)
		}
	}
	res := make([]string, 0, len(seen))
	for name := range seen {
		res = append(res, name)
	}
	slices.Sort(res)
	return res, nil
}
