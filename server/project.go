package server

import (
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/store"
)

// projectPrefix is the one segment under which every project lives. Nothing at
// the root of the server ever belongs to a project, and nothing below this
// segment is ever global, which is what makes the boundary a rule instead of a
// coincidence.
const projectPrefix = "/p/"

// the kinds a project is configured as, which is all /api/projects says about
// where the notes come from.
const (
	KindLocal  = "local"
	KindRemote = "remote"
)

// Project is one notes directory served under its own URL prefix. It bundles
// what used to be the singular fields of Web, so the server holds N of them and
// every handler still works against one.
type Project struct {
	Name     string // url slug, "notes"
	Label    string // what the switcher shows, defaults to Name
	Kind     string // KindLocal or KindRemote
	ReadOnly bool   // this project alone, on top of Config.ReadOnly

	Store    *store.Store
	Renderer *render.Renderer
	Index    *search.Index
	History  History
}

// Prefix is the URL subtree this project owns. It is derived from the name so
// the two cannot drift apart, and it carries no trailing slash: every physical
// URL is the prefix plus a path, and a path always begins with one.
func (p *Project) Prefix() string { return projectPrefix + p.Name }

// Title is what a switcher shows, falling back to the name nobody gave a label.
func (p *Project) Title() string {
	if p.Label != "" {
		return p.Label
	}
	return p.Name
}

// mount is one project bound to the server it is served by. Every handler that
// reads a store hangs off it, so the singular shape each of them is written
// against is preserved and no handler grows a parameter.
type mount struct {
	*Web
	prj *Project
}

// readOnly is the effective mode of this project: the server-wide guard is a
// ceiling a project can only add to, never lift.
func (m *mount) readOnly() bool { return m.ReadOnly || m.prj.ReadOnly }
