package format

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// the formatter starts this very binary as its worker
func TestMain(m *testing.M) {
	RunWorkerIfAsked()
	os.Exit(m.Run())
}

func TestMarkdown(t *testing.T) {
	tests := []struct {
		name string
		text string
		want string
	}{
		{
			name: "headings, lists and blank lines",
			text: "#  Заголовок\n\n\n* один\n* два\n",
			want: "# Заголовок\n\n- один\n- два\n",
		},
		{
			name: "a table is aligned",
			text: "|a|b|\n|-|-|\n|длинная ячейка|2|\n",
			want: "| a              | b   |\n| -------------- | --- |\n| длинная ячейка | 2   |\n",
		},
		{
			name: "the code in a fence is formatted by its own plugin",
			text: "```json\n{\"a\":1}\n```\n\n```ts\nconst  a:number=1\n```\n\n```css\na{color:red}\n```\n",
			want: "```json\n{ \"a\": 1 }\n```\n\n```ts\nconst a: number = 1;\n```\n\n```css\na {\n  color: red;\n}\n```\n",
		},
		{
			name: "front matter is formatted as yaml",
			text: "---\ntitle:   Note\n---\n\ntext\n",
			want: "---\ntitle: Note\n---\n\ntext\n",
		},
		{
			name: "a formatted note comes back as it was",
			text: "# Title\n\n- one\n- two\n",
			want: "# Title\n\n- one\n- two\n",
		},
		{name: "an empty note", text: "", want: ""},
	}

	fmtr := New(2)
	t.Cleanup(fmtr.Close)
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := fmtr.Markdown(context.Background(), tc.text)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestMarkdownRefusesANoteAboveTheCap(t *testing.T) {
	// arrange
	fmtr := New(1)

	// act
	_, err := fmtr.Markdown(context.Background(), strings.Repeat("a", MaxSize+1))

	// assert
	require.ErrorIs(t, err, ErrTooLarge)
}

func TestMarkdownKillsARunThatOutlivesItsDeadline(t *testing.T) {
	// arrange
	fmtr := New(1)
	t.Cleanup(fmtr.Close)
	// prettier is quadratic on this: 8KB of it runs for half a minute
	quadratic := strings.Repeat("[", 8<<10) + "\n"
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	// act
	started := time.Now()
	_, err := fmtr.Markdown(ctx, quadratic)
	waited := time.Since(started)
	after, afterErr := fmtr.Markdown(context.Background(), "*  one\n")

	// assert
	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Less(t, waited, 5*time.Second)
	require.NoError(t, afterErr, "the one worker has to be back for the next note")
	assert.Equal(t, "- one\n", after)
}

// the editor formats in the browser and the server formats everything else,
// so the two copies of prettier have to be the same one
func TestTheBrowserAndTheServerRunTheSamePrettier(t *testing.T) {
	// arrange
	version := func(file string) string {
		raw, err := os.ReadFile(file)
		require.NoError(t, err)
		var pkg struct {
			Dependencies map[string]string `json:"dependencies"`
		}
		require.NoError(t, json.Unmarshal(raw, &pkg))
		return pkg.Dependencies["prettier"]
	}

	// act
	server, browser := version("js/package.json"), version("../web/package.json")

	// assert
	require.NotEmpty(t, server)
	assert.Equal(t, server, browser)
}

func TestMarkdownAfterClose(t *testing.T) {
	// arrange
	fmtr := New(1)
	fmtr.Close()

	// act
	_, err := fmtr.Markdown(context.Background(), "# Title\n")

	// assert
	require.Error(t, err)
}
