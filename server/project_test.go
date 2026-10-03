package server

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// secondProject is the project testOpts.second adds beside the first one, over
// a root of its own.
const secondProject = "team"

func TestRootRedirectsToTheFirstProject(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{second: secondProject})

	// act
	resp, _ := ts.do(t, request{path: "/", literal: true})

	// assert
	assert.Equal(t, http.StatusFound, resp.status)
	assert.Equal(t, ts.prefix()+"/", resp.header.Get("Location"))
}

func TestEachProjectServesOnlyItsOwnFiles(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{second: secondProject})
	require.NoError(t, os.WriteFile(filepath.Join(ts.secondRoot, "team.md"),
		[]byte("# Team\n\nonly here\n"), 0o600))

	// act
	first, firstBody := ts.json(t, request{path: "/api/page/guide.md"})
	second, secondBody := ts.json(t, request{path: ts.second().Prefix() + "/api/page/team.md", literal: true})
	crossed, _ := ts.json(t, request{path: ts.second().Prefix() + "/api/page/guide.md", literal: true})
	back, _ := ts.json(t, request{path: "/api/page/team.md"})

	// assert
	require.Equal(t, http.StatusOK, first.status)
	require.Equal(t, http.StatusOK, second.status)
	assert.Equal(t, "Guide", firstBody["title"])
	assert.Equal(t, "Team", secondBody["title"])
	assert.Equal(t, http.StatusNotFound, crossed.status)
	assert.Equal(t, http.StatusNotFound, back.status)
}

// TestRenderedLinksCarryTheProjectPrefix is what the split between a
// router-relative URL and a physical one is for: a href inside a note is
// fetched by the browser directly, so it has to name the project, while the
// edit_url beside it goes to a router that prepends the very same prefix.
func TestRenderedLinksCarryTheProjectPrefix(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{second: secondProject})
	require.NoError(t, os.WriteFile(filepath.Join(ts.secondRoot, "team.md"), []byte("# Team\n"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(ts.secondRoot, "linking.md"),
		[]byte("# Linking\n\n[team](team.md)\n"), 0o600))

	// act
	_, body := ts.json(t, request{path: ts.second().Prefix() + "/api/page/linking.md", literal: true})

	// assert
	assert.Contains(t, body["html"], `href="`+ts.second().Prefix()+`/doc/team.md"`)
	assert.Equal(t, "/edit/linking.md", body["edit_url"],
		"a navigation URL stays router-relative, the router prepends the basename itself")
}

func TestPageCacheKeepsTheProjectsApart(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{second: secondProject})
	require.NoError(t, os.WriteFile(filepath.Join(ts.secondRoot, "guide.md"),
		[]byte("# Other guide\n\nthe second project\n"), 0o600))

	// act
	_, first := ts.json(t, request{path: "/api/page/guide.md"})
	_, second := ts.json(t, request{path: ts.second().Prefix() + "/api/page/guide.md", literal: true})

	// assert
	assert.Equal(t, "Guide", first["title"])
	assert.Equal(t, "Other guide", second["title"], "one path names two documents, one per project")
	assert.Equal(t, 2, ts.pages().len())
}

func TestInvalidateDropsOneProjectOnly(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{second: secondProject})
	require.NoError(t, os.WriteFile(filepath.Join(ts.secondRoot, "guide.md"), []byte("# Other\n"), 0o600))
	ts.json(t, request{path: "/api/page/guide.md"})
	ts.json(t, request{path: ts.second().Prefix() + "/api/page/guide.md", literal: true})
	require.Equal(t, 2, ts.pages().len())

	// act
	ts.Invalidate(secondProject, "guide.md")

	// assert
	assert.Equal(t, 1, ts.pages().len())
	_, kept := ts.pages().get(testProject, "guide.md", revOf(t, ts, "guide.md"))
	assert.True(t, kept)
}

func TestAPIProjectsListsWhatTheSwitcherCanGoTo(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{second: secondProject})
	ts.second().Label = "Team wiki"
	ts.second().Kind = KindRemote

	// act
	resp, body := ts.do(t, request{path: "/api/projects"})

	// assert
	require.Equal(t, http.StatusOK, resp.status)
	assert.JSONEq(t, `[
		{"name":"notes","label":"notes","url":"`+ts.prefix()+`/","kind":"local","read_only":false},
		{"name":"team","label":"Team wiki","url":"`+ts.second().Prefix()+`/","kind":"remote","read_only":false}
	]`, body)
}

// TestFallbacksAreDecidedPerMount is what the global NotFoundHandler cannot do:
// it is set on the root bundle whichever group registers it and knows no
// prefix, so it can neither boot the app for a path inside a project nor answer
// JSON for an API path.
func TestFallbacksAreDecidedPerMount(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name        string
		path        string
		literal     bool
		contentType string
		body        string
	}{
		{
			name: "an unknown path inside a project is the app", path: "/nothing",
			contentType: "text/html", body: `id="scrawl-app-root"`,
		},
		{
			name: "an unknown API path inside a project is json", path: "/api/nothing",
			contentType: "application/json", body: `{"error":"not found"}`,
		},
		{
			name: "an unknown project is neither", path: "/p/nope/doc/guide.md", literal: true,
			contentType: "text/plain",
		},
		{
			name: "a stray path at the root is neither", path: "/nothing", literal: true,
			contentType: "text/plain",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: tc.path, literal: tc.literal})

			// assert
			assert.Equal(t, http.StatusNotFound, resp.status)
			assert.Contains(t, resp.header.Get("Content-Type"), tc.contentType)
			if tc.body != "" {
				assert.Contains(t, body, tc.body)
				return
			}
			assert.NotContains(t, body, "scrawl-app-root",
				"there is no project here, so there is no base to hand the client")
		})
	}
}

func TestProjectReadOnlyRefusesWrites(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{projectReadOnly: true})

	// act
	save, saved := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/guide.md",
		body: jsonBody(t, map[string]string{"content": "# nope\n", "rev": ""}),
	})
	_, me := ts.json(t, request{path: "/api/me"})

	// assert
	assert.Equal(t, http.StatusForbidden, save.status)
	assert.Equal(t, "read-only project, writing is disabled", saved["error"])
	assert.Equal(t, true, me["read_only"],
		"one field carries the effective mode, so nothing offers a save the server refuses")
}

func TestProjectPrefixIsDerivedFromTheName(t *testing.T) {
	// act & assert
	assert.Equal(t, "/p/team", (&Project{Name: "team"}).Prefix())
	assert.Equal(t, "team", (&Project{Name: "team"}).Title())
	assert.Equal(t, "Team wiki", (&Project{Name: "team", Label: "Team wiki"}).Title())
}

func TestRouterRefusesAServerWithoutProjects(t *testing.T) {
	tests := []struct {
		name     string
		projects []*Project
		errText  string
	}{
		{name: "none at all", errText: "no project configured"},
		{
			name:     "two of one name",
			projects: []*Project{{Name: "notes"}, {Name: "notes"}},
			errText:  `two projects named "notes"`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, err := (&Web{Projects: tc.projects}).router()

			// assert
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.errText)
		})
	}
}

// TestProjectAPIGetsAJSONUnauthorized covers the one thing auth had to learn: a
// client that omits Accept and calls a project's API with no session is told so
// in JSON rather than redirected to an HTML form.
func TestProjectAPIGetsAJSONUnauthorized(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})

	// act
	api, body := ts.do(t, request{path: "/api/file/guide.md"})
	page, _ := ts.do(t, request{path: "/doc/guide.md"})

	// assert
	assert.Equal(t, http.StatusUnauthorized, api.status)
	assert.Contains(t, api.header.Get("Content-Type"), "application/json")
	assert.Contains(t, body, "error")
	assert.Equal(t, http.StatusFound, page.status, "a page still goes to the login form")
	assert.Contains(t, page.header.Get("Location"), "/login")
}

func TestOneTokenReachesEveryProject(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true, second: secondProject})

	// act
	first, _ := ts.json(t, request{path: "/api/tree", headers: bearer(testToken)})
	second, _ := ts.json(t,
		request{path: ts.second().Prefix() + "/api/tree", literal: true, headers: bearer(testToken)})

	// assert
	assert.Equal(t, http.StatusOK, first.status)
	assert.Equal(t, http.StatusOK, second.status)
}

// TestGlobalPathsAreOutsideEveryProject keeps the helper the tests lean on from
// drifting away from the boundary the router draws.
func TestGlobalPathsAreOutsideEveryProject(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act & assert
	for _, p := range globalPaths {
		assert.Equal(t, p, ts.resolve(p))
	}
	assert.Equal(t, ts.prefix()+"/api/tree", ts.resolve("/api/tree"))
	assert.Equal(t, ts.prefix()+"/", ts.resolve("/"))
}
