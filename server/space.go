package server

import (
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/store"
)

const spacePrefix = "/s/"

const (
	KindLocal  = "local"
	KindRemote = "remote"
)

type Space struct {
	Name     string
	Label    string
	Kind     string
	ReadOnly bool

	FormatOnSave bool

	Store    *store.Store
	Renderer *render.Renderer
	Index    *search.Index
	History  History

	Webhook *Webhook
}

func (p *Space) HookPath() string { return p.Prefix() + "/hook" }

func (p *Space) Prefix() string { return spacePrefix + p.Name }

func (p *Space) Title() string {
	if p.Label != "" {
		return p.Label
	}
	return p.Name
}

type mount struct {
	*Web
	spc *Space
}

func (m *mount) readOnly() bool { return m.ReadOnly || m.spc.ReadOnly }
