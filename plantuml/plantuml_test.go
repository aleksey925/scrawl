package plantuml

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const retireEveryTimeEnv = "SCRAWL_PLANTUML_TEST_RETIRE"

func TestMain(m *testing.M) {
	if os.Getenv(retireEveryTimeEnv) != "" {
		runWorkerIfAsked(0)
	}
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
		{name: "a mind map", source: "@startmindmap\n* root\n** branch\n@endmindmap", want: "branch"},
		{name: "a c4 diagram from the library", source: "@startuml\n!include <C4/C4_Container>\nPerson(u, \"Reader\")\n@enduml", want: "Reader"},
		{name: "an alias of a library", source: "@startuml\n!include <material/common>\n!include <material/folder_move>\nMA_FOLDER_MOVE(Red, 1, dir, rectangle, \"Home\")\n@enduml", want: "Home"},
		{name: "a theme", source: "@startuml\n!theme cerulean\nA -> B : themed\n@enduml", want: "themed"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			svg, err := shared.svg(context.Background(), tc.source)

			// assert
			require.NoError(t, err)
			assert.True(t, strings.HasPrefix(svg, "<svg"))
			assert.Contains(t, svg, tc.want)
		})
	}
}

func TestSVGDrawsAnIcon(t *testing.T) {
	// act
	svg, err := shared.svg(context.Background(), "@startuml\nA -> B : <&heart> loved\n@enduml")

	// assert
	require.NoError(t, err)
	assert.Regexp(t, `<path d="[^"]+" fill="#000"/><text [^>]*>loved</text>`, svg)
}

func TestSVGDrawsAnEmojiWithALongPath(t *testing.T) {
	// act
	svg, err := shared.svg(context.Background(), "@startuml\nA -> B : <:smile:> smiled\n@enduml")

	// assert
	require.NoError(t, err)
	assert.Regexp(t, `<path d="[^"]+" fill="#FFCC4D"/>(<path [^>]+>)+<text [^>]*>smiled</text>`, svg)
}

func TestSVGOfADiagramThatCrashesTheEngine(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	crashing := "@startuml\nA -> B : " + strings.Repeat("word ", 2000) + "\n@enduml"

	// act
	_, err := r.svg(context.Background(), crashing)

	// assert
	var diagramErr *diagramError
	require.ErrorAs(t, err, &diagramErr)
	assert.Equal(t, &diagramError{Message: engineFailed}, diagramErr)
	svg, err := r.svg(context.Background(), "@startuml\nA -> B : next\n@enduml")
	require.NoError(t, err, "the worker whose engine crashed is replaced for the next diagram")
	assert.Contains(t, svg, "next")
}

func TestSVGDrawsASpriteAsAPicture(t *testing.T) {
	// act
	svg, err := shared.svg(context.Background(), "@startuml\n!include <C4/C4_Context>\nPerson(u, \"Reader\")\n@enduml")

	// assert
	require.NoError(t, err)
	sprite := regexp.MustCompile(`<image width="(\d+)" height="(\d+)" [^>]*href="data:image/png;base64,([^"]+)"`).FindStringSubmatch(svg)
	require.Len(t, sprite, 4)
	raw, err := base64.StdEncoding.DecodeString(sprite[3])
	require.NoError(t, err)
	picture, err := png.DecodeConfig(bytes.NewReader(raw))
	require.NoError(t, err)
	assert.Equal(t, []string{sprite[1], sprite[2]}, []string{strconv.Itoa(picture.Width), strconv.Itoa(picture.Height)})
}

func TestSVGAfterTheWorkerRetired(t *testing.T) {
	// arrange
	t.Setenv(retireEveryTimeEnv, "1")
	r := New(1)
	t.Cleanup(r.Close)
	_, err := r.svg(context.Background(), "@startuml\nA -> B : before\n@enduml")
	require.NoError(t, err)

	// act
	svg, err := r.svg(context.Background(), "@startuml\nA -> B : after\n@enduml")

	// assert
	require.NoError(t, err, "a worker that retired after its answer is started again for the next diagram")
	assert.Contains(t, svg, "after")
}

func TestSVGOfABrokenDiagram(t *testing.T) {
	tests := []struct {
		name   string
		source string
		line   int
	}{
		{name: "a syntax error", source: "@startuml\nAlice -> Bob\nfoo bar baz\n@enduml", line: 3},
		{name: "a syntax error with no @startuml", source: "Alice -> Bob\nfoo bar baz", line: 2},
		{name: "an empty diagram", source: "", line: 0},
		{name: "a library that does not exist", source: "@startuml\n!include <nosuchlib/x>\nA -> B\n@enduml", line: 2},
		{name: "a library name that climbs out", source: "@startuml\n!include <../../x/y>\nA -> B\n@enduml", line: 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, err := shared.svg(context.Background(), tc.source)

			// assert
			var diagramErr *diagramError
			require.ErrorAs(t, err, &diagramErr)
			assert.Equal(t, tc.line, diagramErr.Line)
			assert.NotEmpty(t, diagramErr.Message)
		})
	}
}

func TestSVGTakesASourceAtTheCap(t *testing.T) {
	// arrange
	diagram := "A -> B : at the cap\n'"
	source := diagram + strings.Repeat("x", maxSource-len(diagram))

	// act
	svg, err := shared.svg(context.Background(), source)

	// assert
	require.NoError(t, err)
	assert.Contains(t, svg, "at the cap")
}

func TestSVGRefusesASourceAboveTheCap(t *testing.T) {
	// act
	_, err := shared.svg(context.Background(), strings.Repeat("x", maxSource+1))

	// assert
	require.ErrorIs(t, err, errTooLarge)
}

func TestSVGKeepsADiagramStillDrawnWhenTheBudgetRanOut(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	source := "@startuml\nA -> B : over budget\n@enduml"
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	// act
	_, err := r.svg(ctx, source)

	// assert
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Eventually(t, func() bool { return drawingNow(r) == 0 }, time.Minute, 10*time.Millisecond)
	r.pool.Close()
	svg, afterErr := r.svg(context.Background(), source)
	require.NoError(t, afterErr, "the drawing is finished and kept, the next export takes it from the cache")
	assert.Contains(t, svg, "over budget")
}

func TestSVGKeepsADiagramKilledAtTheLimit(t *testing.T) {
	// arrange
	r := newRenderer(1, time.Millisecond)
	t.Cleanup(r.Close)
	source := "@startuml\nA -> B : endless\n@enduml"
	_, err := r.svg(context.Background(), source)
	r.pool.Close()

	// act
	_, again := r.svg(context.Background(), source)

	// assert
	want := &diagramError{Message: tooSlow}
	var diagramErr *diagramError
	require.ErrorAs(t, err, &diagramErr)
	assert.Equal(t, want, diagramErr)
	require.ErrorAs(t, again, &diagramErr, "the next call answers from the cache and asks no worker of the closed pool")
	assert.Equal(t, want, diagramErr)
}

func TestSVGJoinsADrawingWhoseClientLeft(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	source := "@startuml\nA -> B : one drawing\n@enduml"
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, err := r.svg(ctx, source)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Equal(t, 1, drawingNow(r), "the drawing goes on without the client that asked for it")

	// act
	svg, err := r.svg(context.Background(), source)

	// assert
	require.NoError(t, err, "the next export waits for that drawing instead of starting another")
	assert.Contains(t, svg, "one drawing")
	assert.Equal(t, 0, drawingNow(r))
}

func TestSVGIsCached(t *testing.T) {
	// arrange
	r := New(1)
	source := "@startuml\nA -> B : once\n@enduml"
	first, err := r.svg(context.Background(), source)
	require.NoError(t, err)
	r.Close()

	// act
	again, err := r.svg(context.Background(), source)

	// assert
	require.NoError(t, err, "a closed renderer answers what it has drawn")
	assert.Equal(t, first, again)
}

func drawingNow(r *Renderer) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.drawing)
}

type drawn struct {
	svg string
	err error
}

func drawInBackground(ctx context.Context, r *Renderer, source string) <-chan drawn {
	out := make(chan drawn, 1)
	go func() {
		svg, err := r.svg(ctx, source)
		out <- drawn{svg: svg, err: err}
	}()
	return out
}

func TestSVGWaitsForTheSameDiagramBeingDrawn(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	source := "A -> B : shared"
	first := drawInBackground(context.Background(), r, source)
	require.Eventually(t, func() bool { return drawingNow(r) == 1 }, 5*time.Second, time.Millisecond)
	gone, cancel := context.WithCancel(context.Background())
	cancel()

	// act
	_, goneErr := r.svg(gone, source)
	second := drawInBackground(context.Background(), r, source)
	time.Sleep(50 * time.Millisecond)
	registered := drawingNow(r)

	// assert
	require.ErrorIs(t, goneErr, context.Canceled)
	assert.ErrorContains(t, goneErr, "wait for the diagram to be drawn")
	assert.Equal(t, 1, registered, "the second call joins the first one's drawing instead of starting its own")
	leader, follower := <-first, <-second
	require.NoError(t, leader.err)
	require.NoError(t, follower.err)
	assert.Equal(t, leader.svg, follower.svg)
}

func TestSVGDrawsItselfWhenTheCallItWaitedForLeftWaiting(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	busy := drawInBackground(context.Background(), r, "A -> B : busy")
	require.Eventually(t, func() bool { return drawingNow(r) == 1 }, 5*time.Second, time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	left := drawInBackground(ctx, r, "A -> B : wanted")
	require.Eventually(t, func() bool { return drawingNow(r) == 2 }, 5*time.Second, time.Millisecond)
	stayed := drawInBackground(context.Background(), r, "A -> B : wanted")
	time.Sleep(50 * time.Millisecond)

	// act
	cancel()

	// assert
	leftRes := <-left
	require.ErrorIs(t, leftRes.err, context.Canceled)
	assert.ErrorContains(t, leftRes.err, "wait for the diagram to be drawn", "a call stops waiting when its client leaves")
	stayedRes := <-stayed
	require.NoError(t, stayedRes.err)
	assert.Contains(t, stayedRes.svg, "wanted")
	busyRes := <-busy
	require.NoError(t, busyRes.err)
	assert.Contains(t, busyRes.svg, "busy")
}

func TestSVGFinishesADrawingAfterItsClientLeaves(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	ctx, cancel := context.WithCancel(context.Background())
	source := "A -> B : finished"
	left := drawInBackground(ctx, r, source)
	require.Eventually(t, func() bool { return drawingNow(r) == 1 }, 5*time.Second, time.Millisecond)
	time.Sleep(50 * time.Millisecond)

	// act
	cancel()

	// assert
	leftRes := <-left
	require.ErrorIs(t, leftRes.err, context.Canceled)
	require.Eventually(t, func() bool { return drawingNow(r) == 0 }, time.Minute, 10*time.Millisecond)
	r.pool.Close()
	again, err := r.svg(context.Background(), source)
	require.NoError(t, err, "the drawing is kept")
	assert.Contains(t, again, "finished")
}

func TestSVGTakesADrawingCachedWhileItWaitedToRegister(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	source := "@startuml\nA -> B : finished elsewhere\n@enduml"
	want := response{SVG: "<svg>finished elsewhere</svg>"}
	r.pool.Close()
	r.mu.Lock()
	waiting := drawInBackground(context.Background(), r, source)
	time.Sleep(50 * time.Millisecond)
	r.cache.put(sha256.Sum256([]byte(source)), want)

	// act
	r.mu.Unlock()

	// assert
	got := <-waiting
	require.NoError(t, got.err, "the call asks no worker of the closed pool")
	assert.Equal(t, want.SVG, got.svg)
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
	svg, err := shared.svg(context.Background(), "@startuml\nversion\n@enduml")

	// assert
	require.NoError(t, err)
	assert.Contains(t, svg, pkg.Dependencies["@plantuml/core"])
	assert.Contains(t, svg, lock.Commit[:7])
}

func readAnswers(t *testing.T, out *bytes.Buffer) []response {
	t.Helper()
	answers := []response{}
	dec := json.NewDecoder(out)
	for dec.More() {
		var res response
		require.NoError(t, dec.Decode(&res))
		answers = append(answers, res)
	}
	return answers
}

func TestServe(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		answers []string
		err     string
	}{
		{name: "the end of the input", in: "", answers: []string{}},
		{name: "a diagram, then the end", in: `{"source":"@startuml\nA -> B : served\n@enduml"}`, answers: []string{"served"}},
		{name: "a request that is not json", in: "nope", answers: []string{}, err: "read a request"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			var out bytes.Buffer

			// act
			err := serve(strings.NewReader(tc.in), &out, retireBytes)

			// assert
			if tc.err != "" {
				require.ErrorContains(t, err, tc.err)
			} else {
				require.NoError(t, err)
			}
			answers := readAnswers(t, &out)
			require.Len(t, answers, len(tc.answers))
			for i, res := range answers {
				assert.Contains(t, res.SVG, tc.answers[i])
				assert.False(t, res.Retire)
			}
		})
	}
}

func TestServeRetiresAfterAnAnswerAboveTheMark(t *testing.T) {
	// arrange
	in := `{"source":"@startuml\nA -> B : first\n@enduml"}` + "\n" + `{"source":"@startuml\nA -> B : second\n@enduml"}` + "\n"
	var out bytes.Buffer

	// act
	err := serve(strings.NewReader(in), &out, 0)

	// assert
	require.NoError(t, err)
	answers := readAnswers(t, &out)
	require.Len(t, answers, 1, "the worker stops after the answer that retires it")
	assert.True(t, answers[0].Retire)
	assert.Contains(t, answers[0].SVG, "first")
}

func TestEngineRenderHandsOverTheLibrariesItAsksFor(t *testing.T) {
	// arrange
	var toEngine bytes.Buffer
	eng := &engine{
		enc: newEncoder(&toEngine),
		dec: json.NewDecoder(strings.NewReader(`{"need":"openiconic.js"}{"need":"nosuch.min.js"}{"svg":"<svg/>"}`)),
	}

	// act
	res, err := eng.render(request{Source: "A -> B"})

	// assert
	require.NoError(t, err)
	assert.Equal(t, response{SVG: "<svg/>"}, res)
	sent := json.NewDecoder(&toEngine)
	var req request
	require.NoError(t, sent.Decode(&req))
	var found, missing libraryReply
	require.NoError(t, sent.Decode(&found))
	require.NoError(t, sent.Decode(&missing))
	code, err := libraryFile("openiconic.js")
	require.NoError(t, err)
	assert.Equal(t, libraryReply{Code: string(code)}, found)
	assert.Contains(t, missing.Error, "nosuch.min.js")
	assert.NotContains(t, toEngine.String(), `<`, "library code goes as it is, not escaped for html")
}

func TestEngineRenderWhenTheEngineDies(t *testing.T) {
	// arrange
	eng := &engine{
		enc: newEncoder(io.Discard),
		dec: json.NewDecoder(strings.NewReader(`{"need":"themes.js"}`)),
	}

	// act
	_, err := eng.render(request{Source: "A -> B"})

	// assert
	require.ErrorContains(t, err, "read what the engine answered")
}

func TestCache(t *testing.T) {
	key := func(name string) [sha256.Size]byte { return sha256.Sum256([]byte(name)) }
	sized := func(n int) response { return response{SVG: strings.Repeat("s", n)} }
	tests := []struct {
		name       string
		maxEntries int
		maxBytes   int
		puts       []string
		sizes      map[string]int
		want       []string
		bytes      int
	}{
		{name: "the oldest goes past the count", maxEntries: 2, maxBytes: 100, puts: []string{"a", "b", "c"}, want: []string{"b", "c"}, bytes: 2},
		{name: "the oldest goes past the bytes", maxEntries: 10, maxBytes: 10, puts: []string{"a", "b"}, sizes: map[string]int{"a": 6, "b": 6}, want: []string{"b"}, bytes: 6},
		{name: "an entry larger than the cache is not kept", maxEntries: 10, maxBytes: 10, puts: []string{"a", "big"}, sizes: map[string]int{"big": 11}, want: []string{"a"}, bytes: 1},
		{name: "a put again keeps an entry once", maxEntries: 2, maxBytes: 100, puts: []string{"a", "b", "a", "c"}, want: []string{"a", "c"}, bytes: 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			c := newCache(tc.maxEntries, tc.maxBytes)
			size := func(name string) int {
				if n, ok := tc.sizes[name]; ok {
					return n
				}
				return 1
			}

			// act
			for _, name := range tc.puts {
				c.put(key(name), sized(size(name)))
			}

			// assert
			kept := []string{}
			for _, name := range []string{"a", "b", "c", "big"} {
				if res, ok := c.get(key(name)); ok {
					assert.Equal(t, sized(size(name)), res)
					kept = append(kept, name)
				}
			}
			assert.Equal(t, tc.want, kept)
			assert.Equal(t, tc.bytes, c.bytes)
		})
	}
}

func TestCacheKeepsAnEntryThatIsRead(t *testing.T) {
	// arrange
	c := newCache(2, 100)
	first, second, third := sha256.Sum256([]byte("a")), sha256.Sum256([]byte("b")), sha256.Sum256([]byte("c"))
	c.put(first, response{SVG: "a"})
	c.put(second, response{SVG: "b"})

	// act
	_, _ = c.get(first)
	c.put(third, response{SVG: "c"})

	// assert
	_, keptFirst := c.get(first)
	_, keptSecond := c.get(second)
	assert.Equal(t, []bool{true, false}, []bool{keptFirst, keptSecond})
}

func TestInline(t *testing.T) {
	// arrange
	fragment := "<h1>A</h1>\n" +
		`<pre class="plantuml" data-source-start="3">A -&gt; B : drawn &amp; &#34;quoted&#34;` + "\n</pre>\n" +
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
	assert.Contains(t, string(svg), `drawn &amp; "quoted"`)
	assert.Contains(t, out, "<h1>A</h1>\n")
	assert.Contains(t, out, "<pre><code>A -&gt; B</code></pre>")
	assert.Contains(t, out, `<div class="md-diagram"><pre class="plantuml" title="a &amp; b">A -&gt; :`+"\nfoo bar\n</pre>"+
		`<p class="md-diagram-error">line 2: `)
	assert.Equal(t, 1, strings.Count(out, "<img"))
}

func TestInlineLeavesADiagramAsCodeWhenTheRendererFails(t *testing.T) {
	// arrange
	r := New(1)
	r.Close()
	block := `<pre class="plantuml">A -&gt; B : never drawn` + "\n</pre>"

	// act
	out, err := r.Inline(context.Background(), "<p>x</p>"+block)

	// assert
	require.ErrorContains(t, err, "a plantuml diagram is left as code: the "+workerName+" is closed")
	assert.Equal(t, `<p>x</p><div class="md-diagram">`+block+
		`<p class="md-diagram-error">the diagram could not be rendered</p></div>`, out)
}

func TestInlineAfterTheContextIsDone(t *testing.T) {
	// arrange
	r := New(1)
	t.Cleanup(r.Close)
	_, err := r.svg(context.Background(), "A -> B : drawn before")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	late := `<pre class="plantuml">A -&gt; B : too late` + "\n</pre>"

	// act
	out, err := r.Inline(ctx, `<pre class="plantuml">A -&gt; B : drawn before</pre>`+late)

	// assert
	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 1, strings.Count(out, "<img"), "a diagram drawn before is taken from the cache")
	assert.Contains(t, out, late+`<p class="md-diagram-error">the diagram could not be rendered</p>`)
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
		{name: "a colored icon", src: "A -> B : <#red&heart>\n", want: []string{"openiconic.js"}},
		{name: "a colored emoji", src: "A -> B : <#red:smile:>\n", want: []string{"emoji.js"}},
		{name: "a scaled emoji", src: "A -> B : <:smile:*2>\n", want: []string{"emoji.js"}},
		{name: "a theme that is not at the start of a line", src: "A -> B : !theme x\n", want: []string{}},
		{
			name: "a library named by a variable",
			src:  "!$lib=\"C4\"\n!include <$lib/C4_Container>\n",
			want: []string{"c4.min.js"},
		},
		{
			name: "a whole path in a variable, set in either branch",
			src: "!if %true()\n  !global $file ?= 'awslib/x'\n!else\n  !$file = \"K8S/y\"\n!endif\n" +
				"!include <$file>\n",
			want: []string{"awslib.min.js", "k8s.min.js"},
		},
		{name: "a variable that is never set", src: "!include <$lib/C4>\n", want: []string{}},
		{name: "a variable set but not included", src: "!$lib = \"C4\"\n", want: []string{}},
		{
			name: "an include quoted in a block that is not plantuml ships the library too",
			src:  "```text\n!include <awslib/x>\n```\n",
			want: []string{"awslib.min.js"},
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
		{name: "an alias brings the version it links, and a library the icons it may draw", names: []string{"material.min.js"}, want: []string{"material.min.js", "material2.1.19.min.js", "openiconic.js"}},
		{
			name:  "a library brings what it includes, and one that does not exist is left out",
			names: []string{"nosuchlib.min.js", "c4.min.js"},
			want:  []string{"c4.min.js", "office.min.js", "openiconic.js", "themes.js"},
		},
		{name: "themes alone bring no icons", names: []string{"themes.js"}, want: []string{"themes.js"}},
		{name: "nothing", names: nil, want: []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			want := make([]Library, 0, len(tc.want))
			for _, file := range tc.want {
				code, err := libraryFile(file)
				require.NoError(t, err)
				want = append(want, Library{Name: file, Code: code})
			}

			// act
			got, err := WithDependencies(tc.names)

			// assert
			require.NoError(t, err)
			assert.Equal(t, want, got)
		})
	}
}

func TestLibraryFileRefusesANameOutsideTheLibrary(t *testing.T) {
	for _, name := range []string{"../plantuml.go", "c4.min.js/../x", ".hidden.js", "C4.min.js", "c4"} {
		t.Run(name, func(t *testing.T) {
			// act
			_, err := libraryFile(name)

			// assert
			require.ErrorIs(t, err, errNoLibrary)
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
