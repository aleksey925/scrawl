package search

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/text/unicode/norm"
)

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

func hits(r Result) []string {
	res := []string{}
	for _, matched := range r.Lines {
		for _, s := range matched.Spans {
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

func TestFindFuzzyHandsAWordJoinedByUnderscoreWhole(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"db.md": "# DB\n\nCall foo_bar and bar.\n"})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "bar", Mode: ModeFuzzy}, 10)

	// assert
	require.NoError(t, err)
	require.Len(t, got.Results, 1)
	assert.Equal(t, FindQuery{Text: "foo_bar|bar", Word: true, Regex: true}, got.Results[0].Find)
}

func TestFindFuzzyCountsEveryMatch(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"a.md": "# A\n\n" + strings.Repeat("word word\n\n", maxSnippetMarks)})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "word", Mode: ModeFuzzy}, 10)

	// assert
	require.NoError(t, err)
	require.Len(t, got.Results, 1)
	assert.Equal(t, 2*maxSnippetMarks, got.Results[0].MatchCount)
	assert.Equal(t, maxSnippetMarks, got.Results[0].LineCount)
}

func TestFindFuzzyMarksATypoInTheTitle(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"db.md": "# Vacuum notes\n\nbody\n"})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "vacum", Mode: ModeFuzzy}, 10)

	// assert
	require.NoError(t, err)
	require.Len(t, got.Results, 1)
	assert.Equal(t, []Span{{Text: "Vacuum", Hit: true}, {Text: " notes"}}, got.Results[0].TitleSpans)
}

func TestFindFuzzyWidensATypoToAFewWords(t *testing.T) {
	// arrange
	notes := map[string]string{}
	for i, r := range []rune("abcdefghijklmnopqrstuwxyzабвгдежзийклмнопрстуфхцчшщ") {
		notes[fmt.Sprintf("n%02d.md", i)] = "# N\n\n" + string(r) + "acuum\n"
	}
	ix := findIndex(t, notes)

	// act
	got, err := ix.Find(context.Background(), Query{Text: "vacuum", Mode: ModeFuzzy}, 100)

	// assert
	require.NoError(t, err)
	assert.Len(t, got.Results, maxTypoTerms)
}

func TestFindExactOrder(t *testing.T) {
	ix := findIndex(t, map[string]string{
		"d.md": "# D\n\nword\n",
		"b.md": "# B\n\nword word\n\nword\n",
		"c.md": "# The word\n\nnothing\n",
		"a.md": "# A\n\nword\n",
	})

	tests := []struct {
		name  string
		limit int
		want  []string
	}{
		{name: "a title first, then the most matches, then the path", limit: 10, want: []string{"c.md", "b.md", "a.md", "d.md"}},
		{name: "the limit keeps the best", limit: 2, want: []string{"c.md", "b.md"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), Query{Text: "word", Mode: ModeExact}, tc.limit)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, paths(got))
		})
	}
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

func TestFindExactAndRegexMatchADecomposedQuery(t *testing.T) {
	// arrange
	composed := "café"
	decomposed := norm.NFD.String(composed)
	ix := findIndex(t, map[string]string{
		"a.md":                   "# Notes\n\nA " + decomposed + " here.\n",
		decomposed + "-notes.md": "nothing\n",
	})

	for _, q := range []Query{{Text: decomposed, Mode: ModeExact}, {Text: decomposed, Regex: true}} {
		t.Run(fmt.Sprintf("regex=%v", q.Regex), func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), q, 10)

			// assert
			require.NoError(t, err)
			assert.Equal(t, []string{decomposed + "-notes.md", "a.md"}, paths(got))
			assert.Equal(t, []string{composed}, hits(got.Results[1]))
			assert.Equal(t, []Span{{Text: composed, Hit: true}, {Text: "-notes"}}, got.Results[0].TitleSpans)
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
			assert.Empty(t, got.Results)
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
		assert.Equal(t, 1, found.Results[0].MatchCount)
	}
}

func TestFindTitlesOnlyMatchesAPhraseInTheTitle(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{
		"foo bar.md": "unrelated text\n",
		"bar foo.md": "the body says foo bar\n",
	})

	// act
	got, err := ix.Find(context.Background(), Query{Text: `"foo bar"`, Mode: ModeFuzzy, TitlesOnly: true}, 10)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []string{"foo bar.md"}, paths(got))
}

func TestFindTitlesOnlyCountsTheTitleMatches(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{
		"a.md": "# Vacuum\n\nvacuum vacuum vacuum\n",
		"b.md": "# Vacuum and vacuum\n\nbody\n",
	})
	tests := []struct {
		name  string
		query Query
	}{
		{name: "fuzzy", query: Query{Text: "vacuum", Mode: ModeFuzzy, TitlesOnly: true}},
		{name: "exact", query: Query{Text: "vacuum", Mode: ModeExact, TitlesOnly: true}},
		{name: "regex", query: Query{Text: "vac+uum", Regex: true, TitlesOnly: true}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), tt.query, 10)

			// assert
			require.NoError(t, err)
			counts := map[string]int{}
			lines := []Line{}
			for _, row := range got.Results {
				counts[row.Path] = row.MatchCount
				lines = append(lines, row.Lines...)
			}
			assert.Equal(t, map[string]int{"a.md": 1, "b.md": 2}, counts)
			assert.Empty(t, lines)
		})
	}
}

func TestFindTitlesOnlyRanksExactAndRegexByTheTitleMatches(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{
		"a.md": "# Vacuum\n\nvacuum vacuum vacuum\n",
		"b.md": "# Vacuum and vacuum\n\nbody\n",
	})
	tests := []struct {
		name  string
		query Query
	}{
		{name: "exact", query: Query{Text: "vacuum", Mode: ModeExact, TitlesOnly: true}},
		{name: "regex", query: Query{Text: "vac+uum", Regex: true, TitlesOnly: true}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), tt.query, 10)

			// assert
			require.NoError(t, err)
			assert.Equal(t, []string{"b.md", "a.md"}, paths(got))
		})
	}
}

func TestFindTitlesOnlyKeepsTheSnippet(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"a.md": "# Vacuum\n\nsome vacuum body\n"})
	tests := []struct {
		name  string
		query Query
	}{
		{name: "exact", query: Query{Text: "vacuum", Mode: ModeExact}},
		{name: "regex", query: Query{Text: "vac+uum", Regex: true}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			titles := tt.query
			titles.TitlesOnly = true

			// act
			got, err := ix.Find(context.Background(), titles, 10)
			require.NoError(t, err)
			everywhere, err := ix.Find(context.Background(), tt.query, 10)
			require.NoError(t, err)

			// assert
			require.Len(t, got.Results, 1)
			require.Len(t, everywhere.Results, 1)
			assert.NotEmpty(t, got.Results[0].Snippet)
			assert.Equal(t, everywhere.Results[0].Snippet, got.Results[0].Snippet)
		})
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
	assert.Len(t, repeated.Results[0].Lines, maxLinesPerResult)
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

type cancelAfter struct {
	context.Context
	calls int
}

func (c *cancelAfter) Err() error {
	c.calls--
	if c.calls <= 0 {
		return context.Canceled
	}
	return nil
}

func TestFindStopsInsideANote(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{"a.md": "# A\n\n" + strings.Repeat("word\n\n", checkEvery+10)})
	ctx := &cancelAfter{Context: context.Background(), calls: 2}

	// act
	got, err := ix.Find(ctx, Query{Text: "word", Mode: ModeExact}, 10)

	// assert
	require.NoError(t, err)
	assert.True(t, got.Truncated)
	require.Len(t, got.Results, 1)
	assert.Equal(t, checkEvery-2, got.Results[0].LineCount, "the title is a line, and the line the stop came on is not read")
}

func TestFindStopsAtTheCapOnMatchedLines(t *testing.T) {
	// arrange
	ix := findIndex(t, map[string]string{
		"a.md": "# A\n\n" + strings.Repeat("word\n\n", maxMatchedLines+10),
		"b.md": "# B\n\nword\n",
	})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "word", Mode: ModeExact}, 10)

	// assert
	require.NoError(t, err)
	assert.True(t, got.Truncated)
	assert.Equal(t, []string{"a.md"}, paths(got))
	assert.Equal(t, maxMatchedLines, got.Results[0].LineCount)
}

func TestCutLine(t *testing.T) {
	// arrange
	before, after := strings.Repeat("я", 150), strings.Repeat("ю", 150)
	line := before + "цель" + after + "цель"
	first := mark{start: off32(len(before)), end: off32(len(before) + len("цель"))}
	last := mark{start: off32(len(line) - len("цель")), end: off32(len(line))}

	// act
	got := cutLine(line, []mark{first, last})

	// assert
	shown := lineWindowRunes - lineLeadRunes - utf8.RuneCountInString("цель")
	assert.Equal(t, []Span{
		{Text: ellipsis},
		{Text: strings.Repeat("я", lineLeadRunes)},
		{Text: "цель", Hit: true},
		{Text: strings.Repeat("ю", shown)},
		{Text: ellipsis},
	}, got)
}

func TestCutLineKeepsAShortLine(t *testing.T) {
	// act
	got := cutLine("a цель b", []mark{{start: 2, end: 10}})

	// assert
	assert.Equal(t, []Span{{Text: "a "}, {Text: "цель", Hit: true}, {Text: " b"}}, got)
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
