package htmlapp

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParse(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want Hosts
	}{
		{name: "empty is the local mode", raw: "", want: Hosts{}},
		{name: "a host per app", raw: "https://app-{id}.example.com",
			want: Hosts{scheme: "https", prefix: "app-", rest: "example.com"}},
		{name: "a trailing slash and a port", raw: "http://app-{id}.apps.home.lan:7272/",
			want: Hosts{scheme: "http", prefix: "app-", rest: "apps.home.lan", port: "7272"}},
		{name: "upper case and a suffix", raw: "HTTPS://App-{id}-X.Example.COM",
			want: Hosts{scheme: "https", prefix: "app-", suffix: "-x", rest: "example.com"}},
		{name: "the id alone in its label", raw: "https://{id}.apps.example.com",
			want: Hosts{scheme: "https", rest: "apps.example.com"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := Parse(tc.raw)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestParseRefuses(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "no id", raw: "https://apps.example.com", want: ErrNoID.Error()},
		{name: "two ids", raw: "https://{id}-{id}.example.com", want: ErrNoID.Error()},
		{name: "id outside the first label", raw: "https://apps.{id}.example.com", want: ErrNoID.Error()},
		{name: "id in the path", raw: "https://apps.example.com/{id}", want: ErrNoID.Error()},
		{name: "another scheme", raw: "ftp://app-{id}.example.com", want: "must be an http or https URL"},
		{name: "no scheme", raw: "app-{id}.example.com", want: "must be an http or https URL"},
		{name: "a user", raw: "https://me@app-{id}.example.com", want: "must have no user, query or fragment"},
		{name: "a query", raw: "https://app-{id}.example.com/?a=1", want: "must have no user, query or fragment"},
		{name: "a fragment", raw: "https://app-{id}.example.com/#x", want: "must have no user, query or fragment"},
		{name: "a path", raw: "https://app-{id}.example.com/apps", want: "must have no path"},
		{name: "no domain", raw: "https://app-{id}", want: "must have a domain after the label with {id}"},
		{name: "a bad character", raw: "https://app_{id}.example.com", want: "may have only letters, digits and - beside {id}"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, err := Parse(tc.raw)

			// assert
			require.EqualError(t, err, tc.want)
		})
	}
}

func TestHostsMatch(t *testing.T) {
	id := ID("notes", "apps/counter")
	perApp, err := Parse("https://app-{id}.example.com")
	require.NoError(t, err)
	withSuffix, err := Parse("https://app-{id}-x.example.com")
	require.NoError(t, err)
	idAlone, err := Parse("https://{id}.example.com")
	require.NoError(t, err)
	tests := []struct {
		name   string
		hosts  Hosts
		host   string
		wantID string
		apps   bool
	}{
		{name: "suffix", hosts: withSuffix, host: "app-" + id + "-x.example.com", wantID: id, apps: true},
		{name: "suffix malformed id", hosts: withSuffix, host: "app-nope-x.example.com", apps: true},
		{name: "suffix missing", hosts: withSuffix, host: "app-" + id + ".example.com"},
		{name: "shorter than prefix and suffix", hosts: withSuffix, host: "app-x.example.com"},
		{name: "id alone", hosts: idAlone, host: id + ".example.com", wantID: id, apps: true},
		{name: "id alone scrawl itself", hosts: idAlone, host: "notes.example.com"},
		{name: "id alone the bare domain", hosts: idAlone, host: "example.com"},
		{name: "per app", hosts: perApp, host: "app-" + id + ".example.com", wantID: id, apps: true},
		{name: "per app with a port, case and a trailing dot", hosts: perApp,
			host: "APP-" + id + ".Example.com.:8443", wantID: id, apps: true},
		{name: "per app malformed id", hosts: perApp, host: "app-nope.example.com", apps: true},
		{name: "per app scrawl itself", hosts: perApp, host: "notes.example.com"},
		{name: "per app another domain", hosts: perApp, host: "app-" + id + ".example.org"},
		{name: "per app deeper name", hosts: perApp, host: "app-" + id + ".x.example.com"},
		{name: "local", hosts: Hosts{}, host: "app-" + id + ".localhost:7272", wantID: id, apps: true},
		{name: "local under a name", hosts: Hosts{}, host: "app-" + id + ".scrawl.localhost:7272", wantID: id, apps: true},
		{name: "local malformed id", hosts: Hosts{}, host: "app-x.localhost", apps: true},
		{name: "local scrawl", hosts: Hosts{}, host: "localhost:7272"},
		{name: "local scrawl under a name", hosts: Hosts{}, host: "scrawl.localhost:7272"},
		{name: "local an address", hosts: Hosts{}, host: "127.0.0.1:7272"},
		{name: "local ipv6", hosts: Hosts{}, host: "[::1]:7272"},
		{name: "local a lan name", hosts: Hosts{}, host: "app-" + id + ".home.lan"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			gotID, apps := tc.hosts.Match(tc.host)

			// assert
			assert.Equal(t, tc.wantID, gotID)
			assert.Equal(t, tc.apps, apps)
		})
	}
}

func TestHostsOrigin(t *testing.T) {
	id := ID("notes", "")
	perApp, err := Parse("https://app-{id}.example.com")
	require.NoError(t, err)
	withPort, err := Parse("http://app-{id}.apps.home.lan:7272")
	require.NoError(t, err)
	withSuffix, err := Parse("https://app-{id}-x.example.com")
	require.NoError(t, err)
	idAlone, err := Parse("https://{id}.apps.example.com")
	require.NoError(t, err)
	tests := []struct {
		name   string
		hosts  Hosts
		parent string
		want   string
		err    error
	}{
		{name: "per app with a suffix", hosts: withSuffix, parent: "https://notes.example.com",
			want: "https://app-" + id + "-x.example.com"},
		{name: "per app with the id alone", hosts: idAlone, parent: "https://notes.example.com",
			want: "https://" + id + ".apps.example.com"},
		{name: "per app", hosts: perApp, parent: "https://notes.example.com",
			want: "https://app-" + id + ".example.com"},
		{name: "per app with a port", hosts: withPort, parent: "http://192.168.1.5:7272",
			want: "http://app-" + id + ".apps.home.lan:7272"},
		{name: "per app the same host", hosts: perApp, parent: "https://app-" + id + ".example.com",
			err: ErrSameHost},
		{name: "local at 127.0.0.1", hosts: Hosts{}, parent: "http://127.0.0.1:7272",
			want: "http://app-" + id + ".localhost:7272"},
		{name: "local at ::1", hosts: Hosts{}, parent: "http://[::1]:7272", err: ErrNotHere},
		{name: "local at localhost", hosts: Hosts{}, parent: "http://localhost:7272",
			want: "http://app-" + id + ".localhost:7272"},
		{name: "local at a name under localhost", hosts: Hosts{}, parent: "https://scrawl.localhost",
			want: "https://app-" + id + ".scrawl.localhost"},
		{name: "local at a lan address", hosts: Hosts{}, parent: "http://192.168.1.5:7272", err: ErrNotHere},
		{name: "local at a lan name", hosts: Hosts{}, parent: "http://notes.home.lan:7272", err: ErrNotHere},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := tc.hosts.Origin(id, tc.parent)

			// assert
			require.ErrorIs(t, err, tc.err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestHostsFrameSources(t *testing.T) {
	// arrange
	perApp, err := Parse("https://app-{id}.example.com")
	require.NoError(t, err)
	withPort, err := Parse("http://app-{id}.apps.home.lan:7272")
	require.NoError(t, err)

	// act & assert
	assert.Equal(t, "http://*.localhost:* https://*.localhost:*", Hosts{}.FrameSources())
	assert.Equal(t, "https://*.example.com", perApp.FrameSources())
	assert.Equal(t, "http://*.apps.home.lan:7272", withPort.FrameSources())
}

func TestHostsCookieName(t *testing.T) {
	// arrange
	secure, err := Parse("https://app-{id}.example.com")
	require.NoError(t, err)
	plain, err := Parse("http://app-{id}.example.com")
	require.NoError(t, err)

	// act & assert
	assert.Equal(t, "__Host-scrawl_app", secure.CookieName())
	assert.Equal(t, "scrawl_app", plain.CookieName())
	assert.Equal(t, "scrawl_app", Hosts{}.CookieName())
}

func TestSameHostname(t *testing.T) {
	// act & assert
	assert.True(t, SameHostname("https://app-abc.example.com", "app-abc.example.com"))
	assert.True(t, SameHostname("http://app-abc.localhost:7272", "APP-ABC.localhost.:7272"))
	assert.False(t, SameHostname("https://app-abc.example.com", "app-xyz.example.com"))
	assert.False(t, SameHostname("app-abc.example.com", "app-abc.example.com"))
	assert.False(t, SameHostname("http://%zz", "app-abc.example.com"))
}

func TestValidHostname(t *testing.T) {
	// act & assert
	assert.True(t, ValidHostname("notes.example.com"))
	assert.True(t, ValidHostname("scrawl-1.localhost"))
	assert.False(t, ValidHostname(""))
	assert.False(t, ValidHostname("Notes.example.com"))
	assert.False(t, ValidHostname("notes_1.example.com"))
	assert.False(t, ValidHostname("notes.example.com/"))
}

func TestID(t *testing.T) {
	// act
	id := ID("notes", "apps/counter")

	// assert
	assert.Regexp(t, `^[a-z2-7]{12}$`, id)
	assert.Equal(t, id, ID("notes", "apps/counter"))
	assert.NotEqual(t, id, ID("other", "apps/counter"))
	assert.NotEqual(t, id, ID("notes", "apps"))
	assert.NotEqual(t, ID("notes", ""), ID("notes", "apps"))
}

func TestFolder(t *testing.T) {
	// act & assert
	assert.Empty(t, Folder("index.html"))
	assert.Equal(t, "apps/counter", Folder("apps/counter/index.html"))
}

func TestRunnable(t *testing.T) {
	// act & assert
	assert.True(t, Runnable("a/index.html"))
	assert.True(t, Runnable("a/INDEX.HTM"))
	assert.False(t, Runnable("a/index.md"))
	assert.False(t, Runnable("a/html"))
}

func TestContentType(t *testing.T) {
	tests := []struct {
		name string
		want string
		ok   bool
	}{
		{name: "index.html", want: "text/html; charset=utf-8", ok: true},
		{name: "a.HTM", want: "text/html; charset=utf-8", ok: true},
		{name: "app.js", want: "text/javascript; charset=utf-8", ok: true},
		{name: "app.mjs", want: "text/javascript; charset=utf-8", ok: true},
		{name: "style.css", want: "text/css; charset=utf-8", ok: true},
		{name: "data.json", want: "application/json; charset=utf-8", ok: true},
		{name: "app.wasm", want: "application/wasm", ok: true},
		{name: "logo.svg", want: "image/svg+xml", ok: true},
		{name: "font.woff2", want: "font/woff2", ok: true},
		{name: "clip.ogg", want: "audio/ogg", ok: true},
		{name: "note.md"},
		{name: "run.sh"},
		{name: "noext"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, ok := ContentType(tc.name)

			// assert
			assert.Equal(t, tc.want, got)
			assert.Equal(t, tc.ok, ok)
		})
	}
}
