package search

import (
	"cmp"
	"html/template"
	"maps"
	"math"
	"slices"
	"strings"
	"sync"
	"unicode/utf8"
)

const (
	bm25K1 = 1.2
	bm25B  = 0.75

	maxQueryTerms = 16

	proximityWeight = 0.6
	proximityScale  = 60
	earlinessWeight = 0.25
	earlinessScale  = 400

	prefixWeight   = 0.5
	maxPrefixTerms = 50

	postingBytes = 48
)

type Hit struct {
	Path    string
	Title   string
	Snippet template.HTML
	Score   float64
	Line    int
}

type posting struct {
	doc    uint32
	counts [numFields]uint32
	offs   []int32
}

type document struct {
	id     uint32
	path   string
	title  string
	plain  string
	code   []span
	lines  []lineMark
	length int
	terms  []string
	mem    int64
}

type Index struct {
	mu         sync.RWMutex
	docs       map[uint32]*document
	byPath     map[string]uint32
	postings   map[string][]posting
	vocab      []string
	vocabStale bool
	nextID     uint32
	length     int64
	size       int64
}

type slot struct {
	list  []posting
	exact []bool
}

func (s slot) boost(i int) float64 {
	if i >= len(s.exact) || s.exact[i] {
		return 1
	}
	return prefixWeight
}

func New() *Index {
	return &Index{
		docs:     make(map[uint32]*document),
		byPath:   make(map[string]uint32),
		postings: make(map[string][]posting),
	}
}

func (ix *Index) Set(path string, content []byte) {
	res := analyze(path, content)

	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.remove(path)
	ix.add(path, res)
}

func (ix *Index) Delete(path string) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.remove(path)
}

func (ix *Index) Len() int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.docs)
}

func (ix *Index) Size() int64 {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.size
}

func (ix *Index) Search(query string, limit int) []Hit {
	return ix.find(query, limit, false)
}

func (ix *Index) SearchPrefix(query string, limit int) []Hit {
	ix.ensureVocab()
	return ix.find(query, limit, true)
}

func (ix *Index) find(query string, limit int, prefix bool) []Hit {
	q := parseQuery(query, prefix)
	if len(q.terms) == 0 || limit <= 0 {
		return nil
	}

	ix.mu.RLock()
	defer ix.mu.RUnlock()

	slots := make([]slot, len(q.terms))
	for k, term := range q.terms {
		s, ok := ix.slotFor(term)
		if !ok {
			return nil
		}
		slots[k] = s
	}
	return ix.rank(q, slots, limit)
}

func (ix *Index) slotFor(term queryTerm) (slot, bool) {
	if !term.prefix {
		list := ix.postings[term.text]
		return slot{list: list}, len(list) > 0
	}

	expanded := ix.prefixMatches(term.text)
	if len(expanded) == 0 {
		return slot{}, false
	}
	res := ix.mergeTerms(term.text, expanded)
	return res, len(res.list) > 0
}

func (ix *Index) prefixMatches(p string) []string {
	i, _ := slices.BinarySearch(ix.vocab, p)
	res := make([]string, 0, 8)
	for ; i < len(ix.vocab) && strings.HasPrefix(ix.vocab[i], p); i++ {
		res = append(res, ix.vocab[i])
		if len(res) == maxPrefixTerms {
			break
		}
	}
	return res
}

func (ix *Index) mergeTerms(exact string, terms []string) slot {
	lists := make([][]posting, 0, len(terms))
	exactAt := -1
	for _, term := range terms {
		list := ix.postings[term]
		if len(list) == 0 {
			continue
		}
		if term == exact {
			exactAt = len(lists)
		}
		lists = append(lists, list)
	}
	if len(lists) == 1 && exactAt == 0 {
		return slot{list: lists[0]}
	}

	res := slot{}
	at := make([]int, len(lists))
	for {
		id, ok := minDoc(lists, at)
		if !ok {
			return res
		}
		merged, isExact := posting{doc: id}, false
		for k := range lists {
			if at[k] >= len(lists[k]) || lists[k][at[k]].doc != id {
				continue
			}
			p := lists[k][at[k]]
			for f := range numFields {
				merged.counts[f] += p.counts[f]
			}
			merged.offs = append(merged.offs, p.offs...)
			isExact = isExact || k == exactAt
			at[k]++
		}
		slices.Sort(merged.offs)
		res.list = append(res.list, merged)
		res.exact = append(res.exact, isExact)
	}
}

func minDoc(lists [][]posting, at []int) (uint32, bool) {
	res, found := uint32(0), false
	for k := range lists {
		if at[k] >= len(lists[k]) {
			continue
		}
		if id := lists[k][at[k]].doc; !found || id < res {
			res, found = id, true
		}
	}
	return res, found
}

func (ix *Index) ensureVocab() {
	ix.mu.RLock()
	stale := ix.vocabStale
	ix.mu.RUnlock()
	if !stale {
		return
	}

	ix.mu.Lock()
	defer ix.mu.Unlock()
	if !ix.vocabStale {
		return
	}
	ix.vocab = slices.Sorted(maps.Keys(ix.postings))
	ix.vocabStale = false
}

func (ix *Index) add(path string, res analyzed) {
	ix.nextID++
	doc := &document{
		id: ix.nextID, path: path, title: res.title, plain: res.plain,
		code: res.code, lines: res.lines, length: len(res.tokens),
	}

	byTerm := make(map[string]*posting, len(res.tokens)/2+1)
	for _, t := range res.tokens {
		p, ok := byTerm[t.term]
		if !ok {
			p = &posting{doc: doc.id}
			byTerm[t.term] = p
			doc.terms = append(doc.terms, t.term)
		}
		p.counts[t.field]++
		if t.off >= 0 {
			p.offs = append(p.offs, t.off)
		}
	}

	doc.mem = int64(len(path)+len(res.title)+len(res.plain)) + int64(len(res.lines)+len(res.code))*8
	for _, term := range doc.terms {
		p := byTerm[term]
		doc.mem += int64(len(term)+postingBytes) + int64(len(p.offs))*4
		list, known := ix.postings[term]
		ix.vocabStale = ix.vocabStale || !known
		ix.postings[term] = append(list, *p)
	}

	ix.docs[doc.id] = doc
	ix.byPath[path] = doc.id
	ix.length += int64(doc.length)
	ix.size += doc.mem
}

func (ix *Index) remove(path string) {
	id, ok := ix.byPath[path]
	if !ok {
		return
	}

	doc := ix.docs[id]
	for _, term := range doc.terms {
		list := ix.postings[term]
		if i, found := findPosting(list, id); found {
			list = slices.Delete(list, i, i+1)
		}
		if len(list) == 0 {
			delete(ix.postings, term)
			ix.vocabStale = true
			continue
		}
		ix.postings[term] = list
	}

	delete(ix.docs, id)
	delete(ix.byPath, path)
	ix.length -= int64(doc.length)
	ix.size -= doc.mem
}

type scored struct {
	doc   *document
	score float64
}

func (ix *Index) top(q parsedQuery, slots []slot, limit int, titlesOnly bool) []topDoc {
	n := float64(len(ix.docs))
	avg := math.Max(float64(ix.length)/n, 1)
	idf := inverseFreq(slots, n)

	seed := shortest(slots)
	res := make([]scored, 0, len(slots[seed].list))
	match := make([]*posting, len(slots))
	boost := make([]float64, len(slots))
	for i := range slots[seed].list {
		id := slots[seed].list[i].doc
		if !collect(slots, id, match, boost) {
			continue
		}
		doc := ix.docs[id]
		res = append(res, scored{doc: doc, score: score(doc, idf, match, boost, avg)})
	}

	slices.SortFunc(res, func(a, b scored) int {
		if c := cmp.Compare(b.score, a.score); c != 0 {
			return c
		}
		return strings.Compare(a.doc.path, b.doc.path)
	})

	top := make([]topDoc, 0, min(limit, len(res)))
	for _, cand := range res {
		if len(top) == limit {
			break
		}
		collect(slots, cand.doc.id, match, boost)
		if titlesOnly && !titleMatchesPhrases(cand.doc.title, q) {
			continue
		}
		if !titlesOnly && !matchesPhrases(cand.doc.plain, q, match) {
			continue
		}
		top = append(top, topDoc{scored: cand, match: slices.Clone(match)})
	}
	return top
}

type topDoc struct {
	scored
	match []*posting
}

func (ix *Index) rank(q parsedQuery, slots []slot, limit int) []Hit {
	top := ix.top(q, slots, limit, false)
	hits := make([]Hit, 0, len(top))
	for _, cand := range top {
		snippet, line := cand.doc.snippet(q.terms, cand.match)
		hits = append(hits, Hit{
			Path: cand.doc.path, Title: cand.doc.title, Snippet: snippet, Score: cand.score, Line: line,
		})
	}
	return hits
}

func score(doc *document, idf []float64, match []*posting, boost []float64, avg float64) float64 {
	lenNorm := 1 - bm25B + bm25B*float64(doc.length)/avg

	var base float64
	for k, p := range match {
		var tf float64
		for f := range numFields {
			c := float64(p.counts[f])
			if c == 0 {
				continue
			}
			tf += fieldWeight[f] * c * (bm25K1 + 1) / (c + bm25K1*lenNorm)
		}
		base += idf[k] * tf * boost[k]
	}
	return base * (1 + proximity(match)) * (1 + earliness(match))
}

func proximity(match []*posting) float64 {
	lists := make([][]int32, 0, len(match))
	for _, p := range match {
		if len(p.offs) > 0 {
			lists = append(lists, p.offs)
		}
	}
	if len(lists) < 2 {
		return 0
	}

	at := make([]int, len(lists))
	best := math.MaxInt32
	for {
		lo, hi, next := int32(math.MaxInt32), int32(0), 0
		for k, offs := range lists {
			off := offs[at[k]]
			if off < lo {
				lo, next = off, k
			}
			hi = max(hi, off)
		}
		best = min(best, int(hi-lo))
		at[next]++
		if at[next] == len(lists[next]) {
			break
		}
	}
	return proximityWeight / (1 + float64(best)/proximityScale)
}

func earliness(match []*posting) float64 {
	first := int32(math.MaxInt32)
	for _, p := range match {
		if len(p.offs) > 0 {
			first = min(first, p.offs[0])
		}
	}
	if first == math.MaxInt32 {
		first = 0
	}
	return earlinessWeight * earlinessScale / (earlinessScale + float64(first))
}

func inverseFreq(slots []slot, n float64) []float64 {
	res := make([]float64, len(slots))
	for k := range slots {
		df := float64(len(slots[k].list))
		res[k] = math.Log(1 + (n-df+0.5)/(df+0.5))
	}
	return res
}

func shortest(slots []slot) int {
	res := 0
	for k := range slots {
		if len(slots[k].list) < len(slots[res].list) {
			res = k
		}
	}
	return res
}

func collect(slots []slot, id uint32, match []*posting, boost []float64) bool {
	for k := range slots {
		i, ok := findPosting(slots[k].list, id)
		if !ok {
			return false
		}
		match[k], boost[k] = &slots[k].list[i], slots[k].boost(i)
	}
	return true
}

func findPosting(list []posting, id uint32) (int, bool) {
	return slices.BinarySearchFunc(list, id, func(p posting, id uint32) int {
		return cmp.Compare(p.doc, id)
	})
}

type queryTerm struct {
	text   string
	prefix bool
	typo   bool
}

type parsedQuery struct {
	terms   []queryTerm
	index   map[string]int
	phrases [][]string
}

func parseQuery(query string, prefix bool) parsedQuery {
	text := normalize(query)
	res := parsedQuery{index: make(map[string]int)}

	last, quoted := "", false
	for i, part := range strings.Split(text, `"`) {
		group := make([]string, 0, 4)
		for _, t := range tokenize(part) {
			group = append(group, t.term)
			last, quoted = t.term, i%2 == 1
			if _, seen := res.index[t.term]; !seen && len(res.terms) < maxQueryTerms {
				res.index[t.term] = len(res.terms)
				res.terms = append(res.terms, queryTerm{text: t.term})
			}
		}
		if i%2 == 1 && len(group) > 1 {
			res.phrases = append(res.phrases, group)
		}
	}

	if k, ok := res.index[last]; ok && prefix && !quoted && endsWithWord(text) {
		res.terms[k].prefix = true
	}
	return res
}

func endsWithWord(query string) bool {
	r, _ := utf8.DecodeLastRuneInString(query)
	return wordRune(r)
}

func matchesPhrases(plain string, q parsedQuery, match []*posting) bool {
	for _, phrase := range q.phrases {
		k, ok := q.index[phrase[0]]
		if !ok {
			continue
		}
		found := slices.ContainsFunc(match[k].offs, func(off int32) bool {
			return phraseAt(plain, phrase, int(off))
		})
		if !found {
			return false
		}
	}
	return true
}

func titleMatchesPhrases(title string, q parsedQuery) bool {
	text := normalize(title)
	words := tokenize(text)
	for _, phrase := range q.phrases {
		found := slices.ContainsFunc(words, func(tok token) bool {
			return tok.term == phrase[0] && phraseAt(text, phrase, tok.off)
		})
		if !found {
			return false
		}
	}
	return true
}
