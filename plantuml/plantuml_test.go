package plantuml

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	RunWorkerIfAsked()
	os.Exit(m.Run())
}

var shared = New(1)

func TestSVG(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   string
	}{
		{name: "a sequence", source: "@startuml\nАлиса -> Боб : привет\n@enduml", want: "Алиса"},
		{name: "a class diagram laid out by smetana", source: "@startuml\nclass Car\ninterface Engine\nCar *-- Engine\n@enduml", want: "Engine"},
		{name: "no @startuml", source: "Alice -> Bob : no start", want: "no start"},
		{name: "a c4 diagram from the library", source: "@startuml\n!include <C4/C4_Container>\nPerson(u, \"Reader\")\n@enduml", want: "Reader"},
		{name: "an alias of a library", source: "@startuml\n!include <material/common>\n!include <material/folder_move>\nMA_FOLDER_MOVE(Red, 1, dir, rectangle, \"Home\")\n@enduml", want: "Home"},
		{name: "a theme", source: "@startuml\n!theme cerulean\nA -> B : themed\n@enduml", want: "themed"},
		{name: "an icon", source: "@startuml\nA -> B : <&heart> loved\n@enduml", want: "loved"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			svg, err := shared.SVG(context.Background(), tc.source)

			// assert
			require.NoError(t, err)
			assert.True(t, strings.HasPrefix(svg, "<svg"))
			assert.Contains(t, svg, tc.want)
		})
	}
}

func TestSVGDrawsASpriteAsAPicture(t *testing.T) {
	// act
	svg, err := shared.SVG(context.Background(), "@startuml\n!include <C4/C4_Context>\nPerson(u, \"Reader\")\n@enduml")

	// assert
	require.NoError(t, err)
	assert.Regexp(t, `<image [^>]*href="data:image/png;base64,iVBORw0KGgo`, svg)
}

func TestSVGAfterALibraryTooLargeToKeep(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	large := "@startuml\n!include <tupadr3/common>\n!include <tupadr3/font-awesome-5/accusoft>\nFA5_ACCUSOFT(x, \"icon\")\n@enduml"
	_, err := r.SVG(context.Background(), large)
	require.NoError(t, err)

	// act
	svg, err := r.SVG(context.Background(), "@startuml\nA -> B : after\n@enduml")

	// assert
	require.NoError(t, err, "the engine that let the library go is started again for the next diagram")
	assert.Contains(t, svg, "after")
}

func TestSVGOfABrokenDiagram(t *testing.T) {
	tests := []struct {
		name   string
		source string
		line   int
	}{
		{name: "a syntax error", source: "@startuml\nAlice -> Bob\nfoo bar baz\n@enduml", line: 3},
		{name: "a library that does not exist", source: "@startuml\n!include <nosuchlib/x>\nA -> B\n@enduml", line: 2},
		{name: "a library name that climbs out", source: "@startuml\n!include <../../x/y>\nA -> B\n@enduml", line: 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, err := shared.SVG(context.Background(), tc.source)

			// assert
			var diagramErr *DiagramError
			require.ErrorAs(t, err, &diagramErr)
			assert.Equal(t, tc.line, diagramErr.Line)
			assert.NotEmpty(t, diagramErr.Message)
		})
	}
}

func TestSVGRefusesASourceAboveTheCap(t *testing.T) {
	// act
	_, err := shared.SVG(context.Background(), strings.Repeat("A -> B\n", MaxSource/7+1))

	// assert
	require.ErrorIs(t, err, ErrTooLarge)
}

func TestSVGKillsARunThatOutlivesItsDeadline(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()

	// act
	_, err := r.SVG(ctx, "@startuml\nA -> B : late\n@enduml")
	svg, afterErr := r.SVG(context.Background(), "@startuml\nA -> B : next\n@enduml")

	// assert
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.NoError(t, afterErr, "the one worker has to be back for the next diagram")
	assert.Contains(t, svg, "next")
}

func TestSVGIsCached(t *testing.T) {
	// arrange
	r := New(1)
	source := "@startuml\nA -> B : once\n@enduml"
	first, err := r.SVG(context.Background(), source)
	require.NoError(t, err)
	r.Close()

	// act
	again, err := r.SVG(context.Background(), source)

	// assert
	require.NoError(t, err, "a closed renderer answers what it has drawn")
	assert.Equal(t, first, again)
}

func TestTheBrowserTheServerAndTheLibraryAreOnePlantUML(t *testing.T) {
	// arrange
	raw, err := os.ReadFile("../web/package.json")
	require.NoError(t, err)
	var pkg struct {
		Dependencies map[string]string `json:"dependencies"`
	}
	require.NoError(t, json.Unmarshal(raw, &pkg))
	raw, err = os.ReadFile("js/library.json")
	require.NoError(t, err)
	var lock struct {
		Commit string `json:"commit"`
	}
	require.NoError(t, json.Unmarshal(raw, &lock))

	// act
	svg, err := shared.SVG(context.Background(), "@startuml\nversion\n@enduml")

	// assert
	require.NoError(t, err)
	assert.Contains(t, svg, pkg.Dependencies["@plantuml/core"])
	assert.Contains(t, svg, lock.Commit[:7])
}

func TestInline(t *testing.T) {
	// arrange
	fragment := "<h1>A</h1>\n" +
		`<pre class="plantuml" data-source-start="3">A -&gt; B : drawn` + "\n</pre>\n" +
		"<pre><code>A -&gt; B</code></pre>\n" +
		`<pre class="plantuml" title="a &amp; b">A -&gt; :` + "\nfoo bar\n</pre>\n"

	// act
	out, err := shared.Inline(context.Background(), fragment)

	// assert
	require.NoError(t, err, "a diagram's own mistake is not a failure of the renderer")
	img := regexp.MustCompile(`<img alt="PlantUML diagram" src="data:image/svg\+xml;base64,([^"]+)">`).FindStringSubmatch(out)
	require.Len(t, img, 2)
	svg, err := base64.StdEncoding.DecodeString(img[1])
	require.NoError(t, err)
	assert.Contains(t, string(svg), "drawn")
	assert.Contains(t, out, "<h1>A</h1>\n")
	assert.Contains(t, out, "<pre><code>A -&gt; B</code></pre>")
	assert.Contains(t, out, `<div class="md-diagram"><pre class="plantuml" title="a &amp; b">A -&gt; :`+"\nfoo bar\n</pre>"+
		`<p class="md-diagram-error">line 2: `)
	assert.Equal(t, 1, strings.Count(out, "<img"))
}

func TestInlineKeepsAnUnclosedBlock(t *testing.T) {
	// arrange
	fragment := `<p>x</p><pre class="plantuml">A -&gt; B`

	// act
	out, err := shared.Inline(context.Background(), fragment)

	// assert
	require.NoError(t, err)
	assert.Equal(t, fragment, out)
}

func TestLibraries(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want []string
	}{
		{name: "nothing included", src: "A -> B\n", want: []string{}},
		{
			name: "includes of every kind, the library name in any case",
			src:  "!include <C4/C4_Container>\n  !includesub <awslib/x/y>\n!import <K8S/x>\n",
			want: []string{"awslib.min.js", "c4.min.js", "k8s.min.js"},
		},
		{
			name: "a theme, an icon and an emoji",
			src:  "!theme cerulean\nA -> B : <&heart> <:smile:>\n",
			want: []string{"emoji.js", "openiconic.js", "themes.js"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got := Libraries([]byte(tc.src))

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestWithDependencies(t *testing.T) {
	tests := []struct {
		name  string
		names []string
		want  []string
	}{
		{name: "an alias brings the version it links", names: []string{"material.min.js"}, want: []string{"material.min.js", "material2.1.19.min.js"}},
		{
			name:  "a library brings what it includes, and one that does not exist is left out",
			names: []string{"nosuchlib.min.js", "c4.min.js"},
			want:  []string{"c4.min.js", "office.min.js", "themes.js"},
		},
		{name: "nothing", names: nil, want: []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := WithDependencies(tc.names)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestLibraryFileRefusesANameOutsideTheLibrary(t *testing.T) {
	for _, name := range []string{"../plantuml.go", "c4.min.js/../x", ".hidden.js", "C4.min.js", "c4"} {
		t.Run(name, func(t *testing.T) {
			// act
			_, err := LibraryFile(name)

			// assert
			require.ErrorIs(t, err, ErrNoLibrary)
		})
	}
}

func TestServeLibrary(t *testing.T) {
	tests := []struct {
		name     string
		file     string
		encoding string
		status   int
		gzipped  bool
	}{
		{name: "compressed for a client that takes gzip", file: "c4.min.js", encoding: "gzip", status: http.StatusOK, gzipped: true},
		{name: "plain for one that does not", file: "c4.min.js", status: http.StatusOK},
		{name: "a name that is not a library", file: "../embed.go", status: http.StatusNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			req.Header.Set("Accept-Encoding", tc.encoding)
			rec := httptest.NewRecorder()

			// act
			ServeLibrary(rec, req, tc.file)

			// assert
			assert.Equal(t, tc.status, rec.Code)
			if tc.status != http.StatusOK {
				return
			}
			assert.Equal(t, tc.gzipped, rec.Header().Get("Content-Encoding") == "gzip")
			assert.Contains(t, rec.Header().Get("Content-Type"), "javascript")
			if !tc.gzipped {
				assert.Contains(t, rec.Body.String(), "PLANTUML_STDLIB")
			}
		})
	}
}
