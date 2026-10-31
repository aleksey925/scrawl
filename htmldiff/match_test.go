package htmldiff

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpcodes(t *testing.T) {
	tests := []struct {
		name string
		a, b string
		want []opcode
	}{
		{name: "both empty", want: []opcode{}},
		{name: "equal", a: "abc", b: "abc", want: []opcode{{kind: opEqual, i1: 0, i2: 3, j1: 0, j2: 3}}},
		{name: "insert only", b: "ab", want: []opcode{{kind: opInsert, i1: 0, i2: 0, j1: 0, j2: 2}}},
		{name: "delete only", a: "ab", want: []opcode{{kind: opDelete, i1: 0, i2: 2, j1: 0, j2: 0}}},
		{
			name: "difflib example",
			a:    "qabxcd",
			b:    "abycdf",
			want: []opcode{
				{kind: opDelete, i1: 0, i2: 1, j1: 0, j2: 0},
				{kind: opEqual, i1: 1, i2: 3, j1: 0, j2: 2},
				{kind: opReplace, i1: 3, i2: 4, j1: 2, j2: 3},
				{kind: opEqual, i1: 4, i2: 6, j1: 3, j2: 5},
				{kind: opInsert, i1: 6, i2: 6, j1: 5, j2: 6},
			},
		},
		{
			name: "longest run wins over an earlier short one",
			a:    "xabcd",
			b:    "abcdx",
			want: []opcode{
				{kind: opDelete, i1: 0, i2: 1, j1: 0, j2: 0},
				{kind: opEqual, i1: 1, i2: 5, j1: 0, j2: 4},
				{kind: opInsert, i1: 5, i2: 5, j1: 4, j2: 5},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got := opcodes(chars(tc.a), chars(tc.b))

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestOpcodesCoverBothSequences(t *testing.T) {
	// arrange
	a := chars(strings.Repeat("abcab", 40) + "zz")
	b := chars("zz" + strings.Repeat("bacba", 40))

	// act
	got := opcodes(a, b)

	// assert
	i, j := 0, 0
	for _, op := range got {
		assert.Equal(t, i, op.i1)
		assert.Equal(t, j, op.j1)
		if op.kind == opEqual {
			assert.Equal(t, a[op.i1:op.i2], b[op.j1:op.j2])
		}
		i, j = op.i2, op.j2
	}
	assert.Equal(t, len(a), i)
	assert.Equal(t, len(b), j)
}

func chars(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, "")
}
