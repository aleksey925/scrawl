package render

import "regexp"

// goldmark's own expressions accept only ASCII, so a bare URL ended at its
// first Cyrillic letter. GitHub takes letters of any script in the host and
// everything up to a space or "<" in the rest; goldmark still trims the
// trailing punctuation and an unbalanced ")".
const (
	linkifyHost = `[-\p{L}\p{M}\p{N}@:%._\+~#=]{1,256}\.\p{Ll}+`
	linkifyTail = `(?:[/#?][^\s<]*)?`
)

var (
	linkifyURLRegexp = regexp.MustCompile(`^(?:http|https|ftp)://` + linkifyHost + `(?::\d+)?` + linkifyTail)
	linkifyWWWRegexp = regexp.MustCompile(`^www\.` + linkifyHost + linkifyTail)
)
