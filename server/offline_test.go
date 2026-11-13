package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/plantuml"
	"github.com/aleksey925/scrawl/view"
)

func versionsOf(t *testing.T, ts *testServer, req request) (response, view.VersionList) {
	t.Helper()
	req.path = "/api/versions"
	resp, body := ts.do(t, req)
	var res view.VersionList
	if resp.status == http.StatusOK {
		require.NoError(t, json.Unmarshal([]byte(body), &res))
	}
	return resp, res
}

func TestAPIVersions(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	root, err := ts.Spaces[0].Store.Tree()
	require.NoError(t, err)

	// act
	resp, got := versionsOf(t, ts, request{})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, pageCacheControl, resp.header.Get("Cache-Control"))
	assert.NotEmpty(t, resp.header.Get("ETag"))
	assert.Equal(t, view.Versions(root, ts.Version), got)
	assert.Equal(t, ts.Version, got.Release)
}

func TestAPIVersionsLeavesOutWhatTheAppDoesNotList(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	for _, name := range []string{".hidden.md", ".git/config", "node_modules/pkg/readme.md"} {
		full := filepath.Join(ts.root, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
		require.NoError(t, os.WriteFile(full, []byte("# hidden\n"), 0o600))
	}

	// act
	_, got := versionsOf(t, ts, request{})

	// assert
	paths := make([]string, 0, len(got.Entries))
	for _, entry := range got.Entries {
		paths = append(paths, entry.Path)
	}
	assert.ElementsMatch(t, []string{
		"", "docs", "docs/sub", "images", "notes",
		"docs/README.md", "docs/page.md", "docs/sub/deep.md", "guide.md", "images/logo.png",
		"index.md", "links.md", "long.markdown", "notes/cyrillic.md", "notes/index.md", "snippet.py",
	}, paths)
}

func TestAPIVersionsFollowsAWrite(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	before, listed := versionsOf(t, ts, request{})
	_, err := ts.Spaces[0].Store.Write("index.md", []byte("# Home\n\nchanged\n"), revOf(t, ts, "index.md"))
	require.NoError(t, err)

	// act
	after, got := versionsOf(t, ts, request{})

	// assert
	assert.NotEqual(t, before.header.Get("ETag"), after.header.Get("ETag"))
	assert.NotEqual(t, versionOfPath(listed, "index.md"), versionOfPath(got, "index.md"))
	assert.NotEqual(t, versionOfPath(listed, ""), versionOfPath(got, ""))
}

func versionOfPath(list view.VersionList, p string) string {
	for _, entry := range list.Entries {
		if entry.Path == p {
			return entry.Version
		}
	}
	return ""
}

func TestAPIVersionsAnswersAMatchingTagWithNotModified(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	first, _ := versionsOf(t, ts, request{})

	// act
	resp, body := ts.do(t, request{path: "/api/versions", headers: map[string]string{
		"If-None-Match": first.header.Get("ETag"),
	}})

	// assert
	assert.Equal(t, http.StatusNotModified, resp.status)
	assert.Empty(t, body)
	assert.Equal(t, first.header.Get("ETag"), resp.header.Get("ETag"))
}

func TestAPIVersionsNeedsASession(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})

	// act
	anonymous, _ := versionsOf(t, ts, request{headers: map[string]string{"Accept": "application/json"}})
	signedIn, _ := versionsOf(t, ts, request{client: ts.login(t)})

	// assert
	assert.Equal(t, http.StatusUnauthorized, anonymous.status)
	assert.Equal(t, http.StatusOK, signedIn.status)
}

func TestAPIVersionsFailsWhenTheTreeFails(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores the permissions this test is about")
	}
	// arrange
	ts := newTestServer(t, testOpts{})
	locked := filepath.Join(ts.root, "docs")
	require.NoError(t, os.Chmod(locked, 0))
	t.Cleanup(func() { _ = os.Chmod(locked, 0o750) })

	// act
	resp, body := ts.json(t, request{path: "/api/versions"})

	// assert
	assert.Equal(t, http.StatusInternalServerError, resp.status)
	assert.NotContains(t, body, "entries")
}

func workerConfigOf(t *testing.T, script string) workerConfig {
	t.Helper()
	line, _, found := strings.Cut(script, "\n")
	require.True(t, found)
	raw, found := strings.CutPrefix(line, "self.scrawlOffline = ")
	require.True(t, found, line)
	var res workerConfig
	require.NoError(t, json.Unmarshal([]byte(strings.TrimSuffix(raw, ";")), &res))
	return res
}

func offlineAppOf(t *testing.T, title, version string) *offlineApp {
	t.Helper()
	wb := &Web{
		Config: Config{Title: title, Version: version, AuthDisabled: true},
		Spaces: []*Space{testSpaceAt(t, testSpace, testNotes(t), false)},
	}
	_, err := wb.router()
	require.NoError(t, err)
	return wb.offline
}

func TestOfflineShell(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	sum := sha256.Sum256(ts.offline.shell)

	// act
	resp, body := ts.do(t, request{path: offlineShellBase + ts.offline.shellFile})
	other, _ := ts.do(t, request{path: offlineShellBase + "000000000000.html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, hex.EncodeToString(sum[:6])+".html", ts.offline.shellFile)
	assert.Equal(t, string(ts.offline.shell), body)
	assert.Equal(t, appCacheControl, resp.header.Get("Cache-Control"))
	assert.Contains(t, resp.header.Get("Content-Type"), "text/html")
	assert.Contains(t, body, `<div id="scrawl-app-root" data-base="" data-version="`+ts.Version+`"><div class="scrawl-splash">`)
	assert.NotContains(t, body, "data-scrawl-theme")
	assert.NotContains(t, body, testSpace)
	assert.Contains(t, body, "<title>"+ts.Title+"</title>")
	assert.Equal(t, http.StatusNotFound, other.status)
	assert.Equal(t, "no-store", other.header.Get("Cache-Control"))
}

func TestOfflineShellIsNamedByItsBody(t *testing.T) {
	// arrange
	first := offlineAppOf(t, "Notes", "v1")

	// act
	same := offlineAppOf(t, "Notes", "v1")
	retitled := offlineAppOf(t, "Other notes", "v1")
	released := offlineAppOf(t, "Notes", "v2")

	// assert
	assert.Equal(t, first.shellFile, same.shellFile)
	assert.NotEqual(t, first.shellFile, retitled.shellFile)
	assert.NotEqual(t, first.shellFile, released.shellFile)
}

func TestWorkerScript(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	worker, err := assets.ReadFile(workerAsset)
	require.NoError(t, err)

	// act
	resp, body := ts.do(t, request{path: "/sw.js", literal: true})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, "text/javascript; charset=utf-8", resp.header.Get("Content-Type"))
	assert.Equal(t, "no-cache", resp.header.Get("Cache-Control"))
	assert.True(t, strings.HasSuffix(body, string(worker)))
	config := workerConfigOf(t, body)
	assert.Equal(t, offlineShellBase+ts.offline.shellFile, config.Shell)
	assert.Len(t, config.Build, 12)
}

func TestWorkerScriptListsEveryFileTheAppLoads(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	_, body := ts.do(t, request{path: "/sw.js", literal: true})
	app, err := assets.Names(appDir)
	require.NoError(t, err)
	library, err := plantuml.LibraryFiles()
	require.NoError(t, err)
	icons, err := assets.Names(iconsDir)
	require.NoError(t, err)
	want := []string{
		"/static/" + ts.Version + "/css/chroma.css",
		iconURL(ts.Version, "favicon.svg"),
		offlineShellBase + ts.offline.shellFile,
	}
	for _, name := range app {
		if name != "manifest.json" && name != "index.html" {
			want = append(want, appBase(ts.appShell.version)+name)
		}
	}
	for _, name := range library {
		want = append(want, "/static/"+ts.appShell.version+"/"+plantuml.LibraryDir+"/"+name)
	}
	for _, name := range icons {
		want = append(want, iconURL(ts.Version, iconsDir+"/"+name))
	}

	// act
	got := workerConfigOf(t, body).Assets

	// assert
	assert.ElementsMatch(t, want, got)
	assert.Contains(t, got, appBase(ts.appShell.version)+appThemes)
}

func TestWorkerScriptListsEveryFileOfTheOfflineShell(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	_, body := ts.do(t, request{path: "/sw.js", literal: true})
	found := regexp.MustCompile(`(?:src|href)="(/static/[^"]+)"`).FindAllStringSubmatch(string(ts.offline.shell), -1)
	require.NotEmpty(t, found)

	// act
	got := workerConfigOf(t, body).Assets

	// assert
	for _, match := range found {
		assert.Contains(t, got, match[1])
	}
}

func TestWorkerScriptListsOnlyWhatTheServerAnswers(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	_, body := ts.do(t, request{path: "/sw.js", literal: true})
	config := workerConfigOf(t, body)

	for _, asset := range config.Assets {
		t.Run(asset, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{path: asset, literal: true})

			// assert
			assert.Equal(t, http.StatusOK, resp.status)
		})
	}
}

func TestWorkerBuildFollowsTheReleaseAndTheTitle(t *testing.T) {
	// arrange
	build := func(app *offlineApp) string { return workerConfigOf(t, string(app.script)).Build }
	first := build(offlineAppOf(t, "Notes", "v1"))

	// act
	same := build(offlineAppOf(t, "Notes", "v1"))
	retitled := build(offlineAppOf(t, "Other notes", "v1"))
	released := build(offlineAppOf(t, "Notes", "v2"))

	// assert
	assert.Equal(t, first, same)
	assert.NotEqual(t, first, retitled)
	assert.NotEqual(t, first, released)
}
