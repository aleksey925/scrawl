package search

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// findIndex is an index over the notes given by path
func findIndex(t *testing.T, notes map[string]string) *Index {
	t.Helper()
	ix := New()
	for path, text := range notes {
		ix.Set(path, []byte(text))
	}
	return ix
}

func paths(found Found) []string {
	res := []string{}
	for _, r := range found.Results {
		res = append(res, r.Path)
	}
	return res
}

// hits are the matched pieces of every line of a result
func hits(r Result) []string {
	res := []string{}
	for _, line := range r.Lines {
		for _, s := range line.Spans {
			if s.Hit {
				res = append(res, s.Text)
			}
		}
	}
	return res
}

func TestFindFuzzy(t *testing.T) {
	ix := findIndex(t, map[string]string{
		"db.md":   "# Индексы\n\nПро индексы и vacuum в базе.\n",
		"misc.md": "# Разное\n\nfoo bar here\n",
	})

	tests := []struct {
		name  string
		query string
		want  []string
	}{
		{name: "the last word is a prefix", query: "индек", want: []string{"db.md"}},
		{name: "one typo in a long word", query: "vacum", want: []string{"db.md"}},
		{name: "no typo in a short word", query: "fop bar", want: []string{}},
		{name: "every word is required", query: "foo vacuum", want: []string{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), Query{Text: tc.query, Mode: ModeFuzzy}, 10)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, paths(got))
		})
	}
}

func TestFindFuzzyHandsTheMatchedWordsToTheNote(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"db.md": "# DB\n\nThe vacuum (full) runs. Vacuum again.\n"})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "vacum", Mode: ModeFuzzy}, 10)

	// assert
	require.NoError(t, err)
	require.Len(t, got.Results, 1)
	assert.Equal(t, FindQuery{Text: "vacuum", Word: true, Regex: true}, got.Results[0].Find)
	assert.Equal(t, []string{"vacuum", "Vacuum"}, hits(got.Results[0]))
}

func TestFindExact(t *testing.T) {
	ix := findIndex(t, map[string]string{
		"a.md": "# Notes\n\nfoo **bar** baz\n\nИндексы, индекс.\nиндексы\n",
	})

	tests := []struct {
		name  string
		query Query
		want  []string
	}{
		{name: "case is ignored by default", query: Query{Text: "FOO", Mode: ModeExact}, want: []string{"foo"}},
		{name: "case is kept when asked", query: Query{Text: "FOO", Mode: ModeExact, Case: true}, want: []string{}},
		{name: "a phrase across markup", query: Query{Text: "foo bar", Mode: ModeExact}, want: []string{"foo bar"}},
		{name: "whole word skips a longer word", query: Query{Text: "индекс", Mode: ModeExact, Word: true},
			want: []string{"индекс"}},
		{name: "whole word at a line start and after punctuation", query: Query{Text: "индексы", Mode: ModeExact, Word: true},
			want: []string{"Индексы", "индексы"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), tc.query, 10)

			// assert
			require.NoError(t, err)
			res := []string{}
			for _, r := range got.Results {
				res = append(res, hits(r)...)
			}
			assert.Equal(t, tc.want, res)
		})
	}
}

func TestFindRegexRunsOverTheTextAsShown(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"a.md": "# Title\n\n## Heading two\n\ntext\n"})

	// act
	heading, err := ix.Find(context.Background(), Query{Text: "^Heading", Regex: true}, 10)
	require.NoError(t, err)
	markup, err := ix.Find(context.Background(), Query{Text: "^## ", Regex: true}, 10)
	require.NoError(t, err)

	// assert
	require.Len(t, heading.Results, 1)
	assert.Equal(t, []Line{{Line: 3, Spans: []Span{{Text: "Heading", Hit: true}, {Text: " two"}}}}, heading.Results[0].Lines)
	assert.Empty(t, markup.Results)
}

func TestFindSkipsEmptyMatches(t *testing.T) {
	ix := findIndex(t, map[string]string{"a.md": "# Z\n\nbbb\n"})

	for _, pattern := range []string{"^", "$", "a*"} {
		t.Run(pattern, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), Query{Text: pattern, Regex: true}, 10)

			// assert
			require.NoError(t, err)
			for _, r := range got.Results {
				assert.Zero(t, r.MatchCount)
				assert.Empty(t, r.Lines)
			}
		})
	}
}

func TestFindTitlesOnly(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"a.md": "# Vacuum\n\nvacuum body\n", "b.md": "# Other\n\nvacuum body\n"})

	// act
	fuzzy, err := ix.Find(context.Background(), Query{Text: "vacuum", Mode: ModeFuzzy, TitlesOnly: true}, 10)
	require.NoError(t, err)
	exact, err := ix.Find(context.Background(), Query{Text: "vacuum", Mode: ModeExact, TitlesOnly: true}, 10)
	require.NoError(t, err)

	// assert
	for _, found := range []Found{fuzzy, exact} {
		assert.Equal(t, []string{"a.md"}, paths(found))
		assert.Empty(t, found.Results[0].Lines)
		assert.Equal(t, []Span{{Text: "Vacuum", Hit: true}}, found.Results[0].TitleSpans)
	}
}

func TestFindLineNumbersAndCounts(t *testing.T) {
	// arrange
	many := strings.Repeat("word\n\n", 30)
	ix := findIndex(t, map[string]string{
		"a.md": "# A\n\n```go\ncode\n```\n\nafter the fence\n",
		"b.md": "# B\n\n" + many,
	})

	// act
	fence, err := ix.Find(context.Background(), Query{Text: "after", Mode: ModeExact}, 10)
	require.NoError(t, err)
	repeated, err := ix.Find(context.Background(), Query{Text: "word", Mode: ModeExact}, 10)
	require.NoError(t, err)

	// assert
	require.Len(t, fence.Results, 1)
	assert.Equal(t, 7, fence.Results[0].Lines[0].Line)
	require.Len(t, repeated.Results, 1)
	assert.Equal(t, 30, repeated.Results[0].LineCount)
	assert.Len(t, repeated.Results[0].Lines, MaxLinesPerResult)
}

func TestFindRefusesABadPattern(t *testing.T) {
	ix := findIndex(t, map[string]string{"a.md": "# A\n"})

	for name, q := range map[string]Query{
		"too long":      {Text: strings.Repeat("a", MaxPattern+1), Mode: ModeExact},
		"not a pattern": {Text: "(", Regex: true},
	} {
		t.Run(name, func(t *testing.T) {
			// act
			_, err := ix.Find(context.Background(), q, 10)

			// assert
			require.ErrorIs(t, err, ErrPattern)
		})
	}
}

func TestFindStopsAtTheDeadline(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"a.md": "# A\n\nword\n"})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// act
	got, err := ix.Find(ctx, Query{Text: "word", Mode: ModeExact}, 10)

	// assert
	require.NoError(t, err)
	assert.True(t, got.Truncated)
}

func TestOneEdit(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{"vacum", "vacuum", true},
		{"vacuum", "vacum", true},
		{"vacuum", "vacuun", true},
		{"vacuum", "vacuum", false},
		{"vacm", "vacuum", false},
		{"индекс", "индекч", true},
	}
	for _, tc := range tests {
		t.Run(tc.a+" "+tc.b, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, oneEdit(tc.a, tc.b))
		})
	}
}
