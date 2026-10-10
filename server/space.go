package server

import (
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/store"
)

// spacePrefix is the one segment under which every space lives. Nothing at
// the root of the server ever belongs to a space, and nothing below this
// segment is ever global, which is what makes the boundary a rule instead of a
// coincidence.
const spacePrefix = "/s/"

// the kinds a space is configured as, which is all /api/spaces says about
// where the notes come from.
const (
	KindLocal  = "local"
	KindRemote = "remote"
)

// Space is one notes directory served under its own URL prefix. It bundles
// what used to be the singular fields of Web, so the server holds N of them and
// every handler still works against one.
type Space struct {
	Name     string // url slug, "notes"
	Label    string // what the switcher shows, defaults to Name
	Kind     string // KindLocal or KindRemote
	ReadOnly bool   // this space alone, on top of Config.ReadOnly

	// FormatOnSave runs prettier over every note a request writes here,
	// in the editor when the editor is the writer and on the server otherwise
	FormatOnSave bool

	Store    *store.Store
	Renderer *render.Renderer
	Index    *search.Index
	History  History

	// Webhook is nil unless the space declared a hook secret, and its route
	// is registered only when it is not.
	Webhook *Webhook
}

// HookPath is where this space's webhook answers. It is one method so that
// the literal has one home: main builds the public path list from it and
// spaceRoutes registers from it.
//
// Under the space subtree because it acts on that space's clone, which is
// the question that decides global versus space. Not under /api/, because
// nothing in the frontend calls it and keeping the one public path out of the
// API subtree makes a later mistake in the public list far cheaper.
func (p *Space) HookPath() string { return p.Prefix() + "/hook" }

// Prefix is the URL subtree this space owns. It is derived from the name so
// the two cannot drift apart, and it carries no trailing slash: every physical
// URL is the prefix plus a path, and a path always begins with one.
func (p *Space) Prefix() string { return spacePrefix + p.Name }

// Title is what a switcher shows, falling back to the name nobody gave a label.
func (p *Space) Title() string {
	if p.Label != "" {
		return p.Label
	}
	return p.Name
}

// mount is one space bound to the server it is served by. Every handler that
// reads a store hangs off it, so the singular shape each of them is written
// against is preserved and no handler grows a parameter.
type mount struct {
	*Web
	spc *Space
}

// readOnly is the effective mode of this space: the server-wide guard is a
// ceiling a space can only add to, never lift.
func (m *mount) readOnly() bool { return m.ReadOnly || m.spc.ReadOnly }
