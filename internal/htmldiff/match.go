package htmldiff

import "sort"

type opKind int

const (
	opEqual opKind = iota
	opReplace
	opDelete
	opInsert
)

type opcode struct {
	kind           opKind
	i1, i2, j1, j2 int
}

type match struct{ i, j, k int }

func opcodes(a, b []string) []opcode {
	m := newMatcher(a, b)
	blocks := m.matchingBlocks()

	res := []opcode{}
	i, j := 0, 0
	for _, blk := range blocks {
		var kind opKind
		switch {
		case i < blk.i && j < blk.j:
			kind = opReplace
		case i < blk.i:
			kind = opDelete
		case j < blk.j:
			kind = opInsert
		default:
			kind = -1
		}
		if kind >= 0 {
			res = append(res, opcode{kind: kind, i1: i, i2: blk.i, j1: j, j2: blk.j})
		}
		i, j = blk.i+blk.k, blk.j+blk.k
		if blk.k > 0 {
			res = append(res, opcode{kind: opEqual, i1: blk.i, i2: i, j1: blk.j, j2: j})
		}
	}
	return res
}

type matcher struct {
	a, b              []string
	b2j               map[string][]int
	prev, cur         []int
	touched, touched2 []int
}

func newMatcher(a, b []string) *matcher {
	b2j := make(map[string][]int, len(b))
	for j, s := range b {
		b2j[s] = append(b2j[s], j)
	}
	return &matcher{a: a, b: b, b2j: b2j, prev: make([]int, len(b)+1), cur: make([]int, len(b)+1)}
}

func (m *matcher) longest(alo, ahi, blo, bhi int) match {
	best := match{i: alo, j: blo}
	for i := alo; i < ahi; i++ {
		for _, j := range m.b2j[m.a[i]] {
			if j < blo {
				continue
			}
			if j >= bhi {
				break
			}
			k := m.prev[j] + 1
			m.cur[j+1] = k
			m.touched2 = append(m.touched2, j+1)
			if k > best.k {
				best = match{i: i - k + 1, j: j - k + 1, k: k}
			}
		}
		for _, idx := range m.touched {
			m.prev[idx] = 0
		}
		m.prev, m.cur = m.cur, m.prev
		m.touched, m.touched2 = m.touched2, m.touched[:0]
	}
	for _, idx := range m.touched {
		m.prev[idx] = 0
	}
	m.touched = m.touched[:0]
	return best
}

func (m *matcher) matchingBlocks() []match {
	type span struct{ alo, ahi, blo, bhi int }
	queue := []span{{0, len(m.a), 0, len(m.b)}}
	found := []match{}
	for len(queue) > 0 {
		sp := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		x := m.longest(sp.alo, sp.ahi, sp.blo, sp.bhi)
		if x.k == 0 {
			continue
		}
		found = append(found, x)
		if sp.alo < x.i && sp.blo < x.j {
			queue = append(queue, span{sp.alo, x.i, sp.blo, x.j})
		}
		if x.i+x.k < sp.ahi && x.j+x.k < sp.bhi {
			queue = append(queue, span{x.i + x.k, sp.ahi, x.j + x.k, sp.bhi})
		}
	}
	sort.Slice(found, func(p, q int) bool {
		if found[p].i != found[q].i {
			return found[p].i < found[q].i
		}
		return found[p].j < found[q].j
	})

	res := []match{}
	for _, x := range found {
		if n := len(res); n > 0 && res[n-1].i+res[n-1].k == x.i && res[n-1].j+res[n-1].k == x.j {
			res[n-1].k += x.k
			continue
		}
		res = append(res, x)
	}
	return append(res, match{i: len(m.a), j: len(m.b)})
}
