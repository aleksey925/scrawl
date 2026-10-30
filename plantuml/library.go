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

var errNoLibrary = errors.New("no such plantuml library")

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
	includedVar = regexp.MustCompile(`!(?:include\w*|import)\s*<\$(\w+)[/>]`)
	assignedVar = regexp.MustCompile(`(?m)^\s*!(?:(?:global|local)\s+)?\$(\w+)\s*\??=\s*["']([A-Za-z0-9][A-Za-z0-9._-]*)`)
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

func inLibrary(name string) bool {
	return libraryName.MatchString(name) && library.Has(name)
}

func libraryFile(name string) ([]byte, error) {
	if !inLibrary(name) {
		return nil, fmt.Errorf("%s: %w", name, errNoLibrary)
	}
	return library.ReadFile(name)
}

func ServeLibrary(w http.ResponseWriter, r *http.Request, name string) {
	if !inLibrary(name) {
		http.NotFound(w, r)
		return
	}
	library.ServeFile(w, r, name)
}

func bundleOf(lib string) string {
	return strings.ToLower(lib) + bundleSuffix
}

func Libraries(src []byte) []string {
	includes := includedLib.FindAllSubmatch(src, -1)
	res := make([]string, 0, len(includes)+len(extraLibraries))
	for _, match := range includes {
		res = append(res, bundleOf(string(match[1])))
	}
	res = append(res, librariesOfVariables(src)...)
	for _, extra := range extraLibraries {
		if extra.pattern.Match(src) {
			res = append(res, extra.file)
		}
	}
	slices.Sort(res)
	return slices.Compact(res)
}

func librariesOfVariables(src []byte) []string {
	included := includedVar.FindAllSubmatch(src, -1)
	if len(included) == 0 {
		return nil
	}
	values := map[string][]string{}
	for _, match := range assignedVar.FindAllSubmatch(src, -1) {
		variable := string(match[1])
		values[variable] = append(values[variable], bundleOf(string(match[2])))
	}
	var res []string
	for _, match := range included {
		res = append(res, values[string(match[1])]...)
	}
	return res
}

func WithDependencies(names []string) (map[string][]byte, error) {
	seen := map[string][]byte{}
	queue := slices.Clone(names)
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if _, ok := seen[name]; ok {
			continue
		}
		code, err := libraryFile(name)
		if errors.Is(err, errNoLibrary) {
			continue
		}
		if err != nil {
			return nil, err
		}
		seen[name] = code
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
	return seen, nil
}
