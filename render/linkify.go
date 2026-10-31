package render

import "regexp"

const (
	linkifyHost = `[-\p{L}\p{M}\p{N}@:%._\+~#=]{1,256}\.\p{Ll}+`
	linkifyTail = `(?:[/#?][^\s<]*)?`
)

var (
	linkifyURLRegexp = regexp.MustCompile(`^(?:http|https|ftp)://` + linkifyHost + `(?::\d+)?` + linkifyTail)
	linkifyWWWRegexp = regexp.MustCompile(`^www\.` + linkifyHost + linkifyTail)
)
