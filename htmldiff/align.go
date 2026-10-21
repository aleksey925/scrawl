package htmldiff

import "strings"

// pairThreshold is how alike a removed and an added block have to be, by the
// share of words they have in common, to be shown as one block that changed
// rather than as one block gone and an unrelated one written.
const pairThreshold = 0.35

// sameTagBonus tips a close call towards pairing a paragraph with a paragraph.
const sameTagBonus = 0.1

// maxPairings bounds the similarity work on one stretch of replaced blocks. A
// note rewritten from top to bottom has nothing worth pairing anyway.
const maxPairings = 250_000

func align(old, cur []block) []Row {
	keys := func(blocks []block) []string {
		res := make([]string, len(blocks))
		for i, blk := range blocks {
			res[i] = blk.key
		}
		return res
	}

	res := []Row{}
	for _, op := range opcodes(keys(old), keys(cur)) {
		if op.kind != opEqual {
			res = append(res, pair(old[op.i1:op.i2], cur[op.j1:op.j2])...)
			continue
		}
		for k := range op.i2 - op.i1 {
			left, right := old[op.i1+k], cur[op.j1+k]
			kind := Same
			if left.html != right.html {
				kind = Format
			}
			res = append(res, Row{Kind: kind, Old: sideOf(left, left.html), New: sideOf(right, right.html)})
		}
	}
	return res
}

// pair walks the removed blocks in order and gives each the most similar added
// block that comes after the last one taken, so the rows never cross. A lone
// block replaced by a lone block of the same kind is one edited block however
// few words survived, the way a renamed heading is.
func pair(removed, added []block) []Row {
	if len(removed) == 1 && len(added) == 1 && removed[0].tag == added[0].tag {
		return []Row{changed(removed[0], added[0])}
	}
	res := []Row{}
	next := 0
	for _, left := range removed {
		best := -1
		if len(removed)*len(added) <= maxPairings {
			bestScore := pairThreshold
			for k := next; k < len(added); k++ {
				score := similarity(left.text, added[k].text)
				if left.tag == added[k].tag {
					score += sameTagBonus
				}
				if score > bestScore {
					best, bestScore = k, score
				}
			}
		}
		if best < 0 {
			res = append(res, Row{Kind: Removed, Old: sideOf(left, left.html)})
			continue
		}
		for ; next < best; next++ {
			res = append(res, Row{Kind: Added, New: sideOf(added[next], added[next].html)})
		}
		res = append(res, changed(left, added[best]))
		next++
	}
	for _, right := range added[next:] {
		res = append(res, Row{Kind: Added, New: sideOf(right, right.html)})
	}
	return res
}

// changed is the row of a pair of blocks that read differently: each side
// with its own words marked, and the two in one block where that can be built.
// A pair too long to compare word by word is shown with no word marked.
func changed(left, right block) Row {
	ta, tb := tokensOf(left.node), tokensOf(right.node)
	if len(ta) > maxTokens || len(tb) > maxTokens {
		return Row{Kind: Changed, Old: sideOf(left, left.html), New: sideOf(right, right.html)}
	}
	ops := opcodes(textsOf(ta), textsOf(tb))
	inline := inlineWords(right, ta, ops)
	oldHTML, newHTML := markWords(left, right, ta, tb, ops)
	res := Row{Kind: Changed, Old: sideOf(left, oldHTML), New: sideOf(right, newHTML)}
	if inline != "" {
		res.Inline = sideOf(right, inline)
	}
	return res
}

func sideOf(blk block, markup string) *Side {
	return &Side{HTML: markup, Start: blk.start, End: blk.end}
}

// similarity is the share of words two texts have in common, counted with
// repetitions, from 0 for nothing shared to 1 for the same words.
func similarity(a, b string) float64 {
	wa, wb := strings.Fields(strings.ToLower(a)), strings.Fields(strings.ToLower(b))
	if len(wa) == 0 && len(wb) == 0 {
		return 1
	}
	pool := make(map[string]int, len(wa))
	for _, word := range wa {
		pool[word]++
	}
	common := 0
	for _, word := range wb {
		if pool[word] > 0 {
			common++
			pool[word]--
		}
	}
	return 2 * float64(common) / float64(len(wa)+len(wb))
}
