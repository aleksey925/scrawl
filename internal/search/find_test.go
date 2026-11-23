package search

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/text/unicode/norm"
)

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

func allHits(found Found) []string {
	res := []string{}
	for _, r := range found.Results {
		res = append(res, hits(r)...)
	}
	return res
}

func TestFindFuzzy(t *testing.T) {
	ix := indexOf(map[string]string{
		"db.md":   "# Индексы\n\nПро индексы, репликацию и vacuum в базе.\n",
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
		{name: "two typos in a long word", query: "реплкацыю", want: []string{"db.md"}},
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
	ix := indexOf(map[string]string{"db.md": "# DB\n\nThe vacuum (full) runs. Vacuum again.\n"})

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
	ix := indexOf(map[string]string{"db.md": "# DB\n\nCall foo_bar and bar.\n"})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "bar", Mode: ModeFuzzy}, 10)

	// assert
	require.NoError(t, err)
	require.Len(t, got.Results, 1)
	assert.Equal(t, FindQuery{Text: "foo_bar|bar", Word: true, Regex: true}, got.Results[0].Find)
}

func TestFindFuzzyCountsEveryMatch(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{"a.md": "# A\n\n" + strings.Repeat("word word\n\n", maxSnippetMarks)})

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
	ix := indexOf(map[string]string{"db.md": "# Vacuum notes\n\nbody\n"})

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
	ix := indexOf(notes)

	// act
	got, err := ix.Find(context.Background(), Query{Text: "vacuum", Mode: ModeFuzzy}, 100)

	// assert
	require.NoError(t, err)
	assert.Len(t, got.Results, maxTypoTerms)
}

func TestFindExactOrder(t *testing.T) {
	ix := indexOf(map[string]string{
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
	ix := indexOf(map[string]string{
		"a.md": "# Notes\n\nfoo **bar** baz\n\nИндексы, индекс.\nиндексы\n\na.b axb (x) x\n",
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
		{name: "a dot is a dot", query: Query{Text: "a.b", Mode: ModeExact}, want: []string{"a.b"}},
		{name: "brackets are brackets", query: Query{Text: "(x)", Mode: ModeExact}, want: []string{"(x)"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), tc.query, 10)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, allHits(got))
		})
	}
}

func TestFindExactAndRegexMatchADecomposedQuery(t *testing.T) {
	// arrange
	composed := "café"
	decomposed := norm.NFD.String(composed)
	ix := indexOf(map[string]string{
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
	ix := indexOf(map[string]string{"a.md": "# Title\n\n## Heading two\n\ntext\n"})

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
	ix := indexOf(map[string]string{"a.md": "# Z\n\nbbb\n"})

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
	ix := indexOf(map[string]string{"a.md": "# Vacuum\n\nvacuum body\n", "b.md": "# Other\n\nvacuum body\n"})

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
	ix := indexOf(map[string]string{
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
	ix := indexOf(map[string]string{
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
	ix := indexOf(map[string]string{
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
	ix := indexOf(map[string]string{"a.md": "# Vacuum\n\nsome vacuum body\n"})
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
	ix := indexOf(map[string]string{
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
	ix := indexOf(map[string]string{"a.md": "# A\n"})

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
	ix := indexOf(map[string]string{"a.md": "# A\n\nword\n"})
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
	ix := indexOf(map[string]string{"a.md": "# A\n\n" + strings.Repeat("word\n\n", checkEvery+10)})
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
	ix := indexOf(map[string]string{
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

func TestWithinTypos(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{"vacum", "vacuum", true},
		{"vacuum", "vacum", true},
		{"vacuum", "vacuun", true},
		{"vacuum", "vacuum", true},
		{"foo", "foo", false},
		{"vacm", "vacuum", false},
		{"индекс", "индекч", true},
		{"σπτιι", "σπιτι", true},
		{"fop", "foo", false},
		{"настрйка", "настройки", true},
		{"настрйка", "наастройкой", false},
		{"vacum", "vcm", false},
		{"тест", "тесл", true},
		{"сервера", "сирвира", false},
		{"документ", "дакумэнт", true},
	}
	for _, tc := range tests {
		t.Run(tc.a+" "+tc.b, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, withinTypos(tc.a, tc.b))
		})
	}
}

func TestFindAccents(t *testing.T) {
	ix := indexOf(map[string]string{
		"el.md": "# Λέξεις\n\nΤο σπίτι είναι μεγάλο. Café au lait, où.\n\nМолоко\u0301 и мой дом, їжак.\n\nЗа\u0301мок, 1\ufe0f\u20e3, ΩΣ.\n\nकुल مُحَمَّد. Ένα παιδί, ᾱ\u0345β.\n\nВсё и все, молоко, замо\u0301к, ǘ, ἄλλο, میخواهم.\n",
	})

	tests := []struct {
		name  string
		query Query
		want  []string
	}{
		{name: "exact keeps the accent", query: Query{Text: "σπιτι", Mode: ModeExact}, want: []string{}},
		{name: "exact keeps a yo", query: Query{Text: "все", Mode: ModeExact}, want: []string{"все"}},
		{name: "exact with an accent the text lacks", query: Query{Text: "τό", Mode: ModeExact, Word: true}, want: []string{}},
		{name: "exact in a capital with an accent", query: Query{Text: "CAFÉ", Mode: ModeExact}, want: []string{"Café"}},
		{name: "exact before a stress mark", query: Query{Text: "молоко", Mode: ModeExact}, want: []string{"Молоко", "молоко"}},
		{name: "match case keeps the accent", query: Query{Text: "σπιτι", Mode: ModeExact, Case: true}, want: []string{}},
		{name: "regex keeps the accent", query: Query{Text: "σπιτι", Regex: true}, want: []string{}},
		{name: "an emoji keeps its variation selector", query: Query{Text: "1\ufe0f\u20e3", Mode: ModeExact},
			want: []string{"1\ufe0f\u20e3"}},
		{name: "whole word looks past a stress mark", query: Query{Text: "мок", Mode: ModeExact, Word: true}, want: []string{}},
		{name: "match case and whole word end past a stress mark", query: Query{Text: "Молоко", Mode: ModeExact, Case: true, Word: true},
			want: []string{"Молоко"}},
		{name: "fuzzy without the accent", query: Query{Text: "μεγαλο", Mode: ModeFuzzy}, want: []string{"μεγάλο"}},
		{name: "fuzzy finds a yo for a ye", query: Query{Text: "все", Mode: ModeFuzzy}, want: []string{"Всё", "все"}},
		{name: "fuzzy keeps a yo typed", query: Query{Text: "всё", Mode: ModeFuzzy}, want: []string{"Всё"}},
		{name: "fuzzy keeps a stress mark typed", query: Query{Text: "молоко\u0301", Mode: ModeFuzzy}, want: []string{"Молоко\u0301"}},
		{name: "fuzzy keeps a stress mark on its letter", query: Query{Text: "замо\u0301к", Mode: ModeFuzzy},
			want: []string{"замо\u0301к"}},
		{name: "fuzzy allows more accents than typed", query: Query{Text: "άλλο", Mode: ModeFuzzy}, want: []string{"ἄλλο"}},
		{name: "fuzzy allows more accents on a short word", query: Query{Text: "ü", Mode: ModeFuzzy}, want: []string{"ǘ"}},
		{name: "fuzzy keeps an accent typed in a typo", query: Query{Text: "μεγάλω", Mode: ModeFuzzy}, want: []string{"μεγάλο"}},
		{name: "fuzzy in a short word", query: Query{Text: "ou", Mode: ModeFuzzy}, want: []string{"où"}},
		{name: "an accent is never a typo", query: Query{Text: "σπιτη", Mode: ModeFuzzy}, want: []string{"σπίτι"}},
		{name: "a short i is a letter of its own", query: Query{Text: "мои", Mode: ModeFuzzy}, want: []string{}},
		{name: "fuzzy without arabic vowel marks", query: Query{Text: "محمد", Mode: ModeFuzzy}, want: []string{"مُحَمَّد"}},
		{name: "fuzzy drops a vowel sign", query: Query{Text: "कल", Mode: ModeFuzzy}, want: []string{"कुल"}},
		{name: "fuzzy looks past a zero width non-joiner", query: Query{Text: "می\u200cخواهم", Mode: ModeFuzzy},
			want: []string{"میخواهم"}},
		{name: "fuzzy takes a final sigma for a sigma", query: Query{Text: "ως", Mode: ModeFuzzy}, want: []string{"ΩΣ"}},
		{name: "a stress mark at the end keeps the prefix", query: Query{Text: "за\u0301", Mode: ModeFuzzy},
			want: []string{"За\u0301мок"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := ix.Find(context.Background(), tc.query, 10)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, allHits(got))
		})
	}
}

func TestFindFuzzyKeepsTypedAccents(t *testing.T) {
	tests := []struct {
		name  string
		docs  map[string]string
		query Query
		want  []string
	}{
		{name: "a title without the accent is no match", docs: map[string]string{"a.md": "# Cafe\n\nUn café.\n"},
			query: Query{Text: "café", Mode: ModeFuzzy, TitlesOnly: true}, want: []string{}},
		{name: "a title with the accent matches", docs: map[string]string{"a.md": "# Café\n\nUn cafe.\n"},
			query: Query{Text: "café", Mode: ModeFuzzy, TitlesOnly: true}, want: []string{"a.md"}},
		{name: "a phrase keeps the accent of each word", docs: map[string]string{"a.md": "# Notes\n\nBon cafe. Café ailleurs.\n"},
			query: Query{Text: `"bon café"`, Mode: ModeFuzzy}, want: []string{}},
		{name: "a phrase with the accent matches", docs: map[string]string{"a.md": "# Notes\n\nBon café ici.\n"},
			query: Query{Text: `"bon café"`, Mode: ModeFuzzy}, want: []string{"a.md"}},
		{name: "an accent on another letter is a typo", docs: map[string]string{"a.md": "# Notes\n\nЗа\u0301мок стоит.\n"},
			query: Query{Text: "замо\u0301к", Mode: ModeFuzzy}, want: []string{"a.md"}},
		{name: "an accent on another letter in a title is a typo", docs: map[string]string{"a.md": "# За\u0301мок\n\nТекст.\n"},
			query: Query{Text: "замо\u0301к", Mode: ModeFuzzy, TitlesOnly: true}, want: []string{"a.md"}},
		{name: "a short word keeps an accent on its letter", docs: map[string]string{"a.md": "# Notes\n\nУ\u0301же нет.\n"},
			query: Query{Text: "уже\u0301", Mode: ModeFuzzy}, want: []string{}},
		{name: "a phrase keeps an accent on its letter", docs: map[string]string{"a.md": "# Notes\n\nЗа\u0301мок стоит.\n"},
			query: Query{Text: "\"замо\u0301к стоит\"", Mode: ModeFuzzy}, want: []string{}},
		{name: "a phrase in a title keeps the accent of each word", docs: map[string]string{"a.md": "# Bon cafe, café\n\nTexte.\n"},
			query: Query{Text: `"bon café"`, Mode: ModeFuzzy, TitlesOnly: true}, want: []string{}},
		{name: "a phrase in a title with the accent matches", docs: map[string]string{"a.md": "# Bon café\n\nTexte.\n"},
			query: Query{Text: `"bon café"`, Mode: ModeFuzzy, TitlesOnly: true}, want: []string{"a.md"}},
		{name: "a word typed twice keeps the accents of both", docs: map[string]string{"a.md": "# Notes\n\nвсе тут.\n", "b.md": "# Notes\n\nвсе и всё.\n"},
			query: Query{Text: "все всё", Mode: ModeFuzzy}, want: []string{"b.md"}},
		{name: "a title typo is looked for past a word only in the body", docs: map[string]string{"a.md": "# За\u0301мок\n\nЗамо\u0301к в тексте.\n"},
			query: Query{Text: "замо\u0301к", Mode: ModeFuzzy, TitlesOnly: true}, want: []string{"a.md"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ix := indexOf(tc.docs)

			// act
			got, err := ix.Find(context.Background(), tc.query, 10)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, paths(got))
		})
	}
}

func TestFindFuzzyLooksForTyposPastAWordWithoutTheAccent(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{"a.md": "# Notes\n\nUn cafe, un caffé.\n"})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "café", Mode: ModeFuzzy}, 10)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []string{"caffé"}, allHits(got))
}

func TestFindFuzzyRanksAnAccentOnAnotherLetterAsATypo(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{
		"a.md": "# Notes\n\nЗа\u0301мок стоит.\n",
		"b.md": "# Notes\n\nЗама\u0301к стоит.\n",
	})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "замо\u0301к", Mode: ModeFuzzy}, 10)

	// assert
	require.NoError(t, err)
	require.Equal(t, []string{"a.md", "b.md"}, paths(got))
	assert.InDelta(t, got.Results[1].Score, got.Results[0].Score, 1e-9)
}

func TestFindFuzzyScoresOnlyTheWordsWithTheTypedAccent(t *testing.T) {
	tests := []struct {
		name  string
		docs  map[string]string
		query string
	}{
		{
			name:  "a word in the body without the accent adds nothing",
			docs:  map[string]string{"a.md": "# Notes\n\nвсё и все все все.\n", "b.md": "# Notes\n\nвсё и это это это.\n"},
			query: "всё",
		},
		{
			name:  "a heading without the accent adds nothing",
			docs:  map[string]string{"a.md": "# Notes\n\n## Cafe\n\nUn café.\n", "b.md": "# Notes\n\n## Kafe\n\nUn café.\n"},
			query: "café",
		},
		{
			name:  "a word in a code block without the accent adds nothing",
			docs:  map[string]string{"a.md": "# Notes\n\nUn café.\n\n```\ncafe\n```\n", "b.md": "# Notes\n\nUn café.\n\n```\nkafe\n```\n"},
			query: "café",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ix := indexOf(tc.docs)

			// act
			got := fuzzyFind(t, ix, tc.query, 10)

			// assert
			require.Len(t, got.Results, 2)
			assert.InDelta(t, got.Results[1].Score, got.Results[0].Score, 1e-9)
		})
	}
}

func TestFindFuzzyMarksOnlyTheTitleWordsWithTheTypedAccent(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{"a.md": "# Cafe et café\n\nTexte.\n"})

	// act
	got, err := ix.Find(context.Background(), Query{Text: "café", Mode: ModeFuzzy, TitlesOnly: true}, 10)

	// assert
	require.NoError(t, err)
	require.Len(t, got.Results, 1)
	assert.Equal(t, []Span{{Text: "Cafe et "}, {Text: "café", Hit: true}}, got.Results[0].TitleSpans)
}

func TestFindRanking(t *testing.T) {
	tests := []struct {
		name  string
		docs  map[string]string
		query string
		want  []string
	}{
		{
			name:  "title beats heading beats body beats code",
			query: "мониторинг",
			want:  []string{"rank/title.md", "rank/heading.md", "rank/body.md", "rank/code.md"},
		},
		{
			name: "one title match beats many body matches",
			docs: map[string]string{
				"title.md": "Мониторинг\n==========\n\nтекст без ключевого слова\n",
				"body.md":  "Заметка\n=======\n\nмониторинг мониторинг мониторинг мониторинг\n",
			},
			query: "мониторинг",
			want:  []string{"title.md", "body.md"},
		},
		{
			name: "more occurrences rank higher",
			docs: map[string]string{
				"many.md": "Заметка\n=======\n\nсеть сеть сеть сеть\n",
				"one.md":  "Заметка\n=======\n\nсеть один два три\n",
			},
			query: "сеть",
			want:  []string{"many.md", "one.md"},
		},
		{
			name: "match closer to the start ranks higher",
			docs: map[string]string{
				"early.md": "Заметка\n=======\n\nсеть в начале документа.\n\n" + filler,
				"late.md":  "Заметка\n=======\n\n" + filler + "\n\nсеть в конце документа.\n",
			},
			query: "сеть",
			want:  []string{"early.md", "late.md"},
		},
		{
			name: "terms standing close rank higher",
			docs: map[string]string{
				"near.md": "Заметка\n=======\n\nрезервное копирование включено. " + filler,
				"far.md":  "Заметка\n=======\n\nрезервное хранение включено. " + filler + " копирование\n",
			},
			query: "резервное копирование",
			want:  []string{"near.md", "far.md"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ix := loadNotes(t)
			if tt.docs != nil {
				ix = indexOf(tt.docs)
			}
			assert.Equal(t, tt.want, paths(fuzzyFind(t, ix, tt.query, 10)))
		})
	}
}

func TestFindMatching(t *testing.T) {
	ix := loadNotes(t)
	tests := []struct {
		name  string
		query string
		want  []string
	}{
		{"single term", "восстановление", []string{"notes/бэкап.md"}},
		{"case does not matter", "УСТАНОВКА", []string{"docker/setup.md"}},
		{"all terms must be present", "резервное копирование",
			[]string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"one missing term drops the document", "резервное nginx", []string{}},
		{"link text is indexed", "compose", []string{"docker/compose.md", "index.md"}},
		{"link target is not indexed", "setup", []string{}},
		{"image alt is indexed", "схема", []string{"docker/setup.md"}},
		{"image target is not indexed", "png", []string{}},
		{"html attribute is not indexed", "name", []string{}},
		{"code is searchable", "systemctl", []string{"rank/code.md"}},
		{"yo matches ye", "еще", []string{"notes/unicode.md"}},
		{"ye matches yo", "ещё", []string{"notes/unicode.md"}},
		{"decomposed query matches composed text", "же\u0308лтый", []string{"notes/unicode.md"}},
		{"zero width space inside a word", "контейнер",
			[]string{"notes/unicode.md", "index.md", "docker/setup.md"}},
		{"combining accent inside a word", "поверх", []string{"notes/unicode.md"}},
		{"non breaking space splits words", "неразрывный пробел", []string{"notes/unicode.md"}},
		{"phrase over a non breaking space", `"резервное копирование"`,
			[]string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"phrase in the wrong order", `"копирование резервное"`, []string{}},
		{"phrase with a word between", `"резервное данных"`, []string{}},
		{"unbalanced quote is still a phrase", `"резервное копирование`,
			[]string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, paths(fuzzyFind(t, ix, tt.query, 10)))
		})
	}
}

func TestFindFuzzyPrefix(t *testing.T) {
	ix := loadNotes(t)
	tests := []struct {
		name  string
		query string
		want  []string
	}{
		{"last term matches by prefix", "копир", []string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"complete term still matches", "копирование", []string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"only the last term is expanded", "резервн копирование", []string{}},
		{"earlier terms stay exact", "резервное копир", []string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"trailing space ends the prefix", "коп ", []string{}},
		{"trailing punctuation ends the prefix", "коп.", []string{}},
		{"quoted term is never expanded", `"резервное копир"`, []string{}},
		{"prefix of nothing finds nothing", "щщщ", []string{}},
		{"a short last term is a prefix too", "коп", []string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, paths(fuzzyFind(t, ix, tt.query, 10)))
		})
	}
}

func TestFindFuzzyPrefixRanking(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{
		"exact.md":  "Заметка\n=======\n\nсервер в этом документе\n",
		"longer.md": "Заметка\n=======\n\nсерверами в этом документе\n",
	})

	// act
	found := fuzzyFind(t, ix, "сервер", 10)

	// assert
	assert.Equal(t, []string{"exact.md", "longer.md"}, paths(found))
	assert.Contains(t, string(found.Results[1].Snippet), "<mark>серверами</mark>")
}

func TestFindFuzzyPrefixStaysBounded(t *testing.T) {
	// arrange
	ix := loadNotes(t)

	// act
	found := fuzzyFind(t, ix, "с", 5)

	// assert
	assert.LessOrEqual(t, len(found.Results), 5)
	assert.LessOrEqual(t, len(ix.prefixMatches("с")), maxPrefixTerms)
}

func TestFindFuzzyPrefixAfterUpdate(t *testing.T) {
	// arrange
	ix := New()
	ix.Set("a.md", []byte("Заметка\n=======\n\nсерверами\n"))
	require.NotEmpty(t, fuzzyFind(t, ix, "сервер", 5).Results)

	// act
	ix.Set("a.md", []byte("Заметка\n=======\n\nхранилищем\n"))

	// assert
	assert.Empty(t, fuzzyFind(t, ix, "сервер", 5).Results)
	assert.Equal(t, []string{"a.md"}, paths(fuzzyFind(t, ix, "хранил", 5)))
}

func TestFindDegenerateQuery(t *testing.T) {
	ix := loadNotes(t)
	tests := []struct {
		name  string
		query string
		limit int
	}{
		{"empty", "", 10},
		{"whitespace only", " \t\n ", 10},
		{"non breaking space only", "\u00a0", 10},
		{"punctuation only", "!!! ??? ...", 10},
		{"regex metacharacters", `(.*)+[a-z]{2,}\\`, 10},
		{"quotes only", `""`, 10},
		{"single letter", "щ", 10},
		{"very long query", strings.Repeat("несуществующее слово ", 2000), 10},
		{"one long token", strings.Repeat("щ", 100000), 10},
		{"zero limit", "мониторинг", 0},
		{"negative limit", "мониторинг", -5},
		{"invalid utf8", "\xff\xfe", 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var found Found
			assert.NotPanics(t, func() { found = fuzzyFind(t, ix, tt.query, tt.limit) })
			assert.Empty(t, found.Results)
		})
	}
}

func TestFindLimit(t *testing.T) {
	// arrange
	ix := loadNotes(t)

	// act
	found := fuzzyFind(t, ix, "мониторинг", 2)

	// assert
	assert.Equal(t, []string{"rank/title.md", "rank/heading.md"}, paths(found))
}

func TestFindResult(t *testing.T) {
	ix := loadNotes(t)

	t.Run("title and line point at the source", func(t *testing.T) {
		found := fuzzyFind(t, ix, "nginx", 5)
		require.Len(t, found.Results, 1)
		hit := found.Results[0]
		assert.Equal(t, "docker/compose.md", hit.Path)
		assert.Equal(t, "Docker Compose", hit.Title)
		lines := make([]int, 0, len(hit.Lines))
		for _, row := range hit.Lines {
			lines = append(lines, row.Line)
		}
		assert.Equal(t, []int{9, 14}, lines)
		assert.Positive(t, hit.Score)
	})

	t.Run("title falls back to the file name", func(t *testing.T) {
		ix := indexOf(map[string]string{"заметки/без-заголовка.md": "просто текст\n"})
		found := fuzzyFind(t, ix, "текст", 5)
		require.Len(t, found.Results, 1)
		assert.Equal(t, "без-заголовка", found.Results[0].Title)
	})
}

func FuzzFind(f *testing.F) {
	seeds := []struct{ doc, query string }{
		{"Заголовок\n=========\n\nтекст документа\n", "текст"},
		{"# Раздел\n\n```go\nкод\n```\n", `"раздел код"`},
		{"[ссылка](a.md) <b>жирный</b> ![альт](i.png)\n", "ссылка альт"},
		{"", ""},
	}
	for _, s := range seeds {
		f.Add(s.doc, s.query)
	}

	f.Fuzz(func(t *testing.T, doc, query string) {
		ix := New()
		ix.Set("fuzz.md", []byte(doc))
		found := fuzzyFind(t, ix, query, 3)
		require.LessOrEqual(t, len(found.Results), 3)
		for _, res := range found.Results {
			snippet := string(res.Snippet)
			require.True(t, utf8.ValidString(snippet) || !utf8.ValidString(doc))
			bare := strings.NewReplacer("<mark>", "", "</mark>", "").Replace(snippet)
			require.NotContains(t, bare, "<")
			require.NotContains(t, bare, ">")
			for _, line := range res.Lines {
				require.Positive(t, line.Line)
			}
		}
	})
}

func BenchmarkFind(b *testing.B) {
	ix := benchIndex(b, 300, 60)
	b.Logf("documents: %d, index size: %.1f MB", ix.Len(), float64(ix.Size())/(1<<20))

	benchmarks := []struct {
		name  string
		query string
	}{
		{"one term", "мониторинг"},
		{"two terms", "резервное копирование"},
		{"three terms", "настройка сеть контейнера"},
		{"phrase", `"резервное копирование"`},
		{"no match", "несуществующееслово"},
		{"prefix one term", "монитор"},
		{"prefix two terms", "резервное копир"},
		{"prefix one letter", "к"},
	}

	for _, bm := range benchmarks {
		b.Run(bm.name, func(b *testing.B) {
			for b.Loop() {
				fuzzyFind(b, ix, bm.query, 10)
			}
		})
	}
}

const filler = "остальной текст заметки нужен только чтобы документы были одинаковой длины " +
	"и отличались лишь местом совпадения внутри текста документа заметки"

var benchWords = strings.Fields(`настройка сервер сеть контейнер образ резервное копирование данных
	хранилище метрика мониторинг запуск команда файл каталог пользователь группа демон служба
	политика доступа журнал ошибка отладка сборка тег ветка коммит слияние конфликт`)

func benchIndex(tb testing.TB, docs, lines int) *Index {
	tb.Helper()

	rnd := rand.New(rand.NewSource(1))
	ix := New()
	var b strings.Builder
	for d := range docs {
		b.Reset()
		fmt.Fprintf(&b, "Заметка номер %d\n===============\n\n", d)
		for l := range lines {
			if l%10 == 0 {
				b.WriteString("\n## Раздел про сеть и контейнера\n\n")
			}
			for range 12 {
				b.WriteString(benchWords[rnd.Intn(len(benchWords))])
				b.WriteByte(' ')
			}
			b.WriteByte('\n')
		}
		ix.Set(fmt.Sprintf("dir%d/doc%d.md", d%20, d), []byte(b.String()))
	}
	return ix
}

func fuzzyFind(tb testing.TB, ix *Index, query string, limit int) Found {
	tb.Helper()
	found, err := ix.Find(context.Background(), Query{Text: query, Mode: ModeFuzzy}, limit)
	require.NoError(tb, err)
	return found
}
