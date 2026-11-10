package view

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"strings"

	"github.com/aleksey925/scrawl/store"
)

const (
	VersionDir  = "dir"
	VersionNote = "note"
	VersionFile = "file"
)

type VersionList struct {
	Release string         `json:"release"`
	Entries []VersionEntry `json:"entries"`
}

type VersionEntry struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Version string `json:"version"`
}

func Versions(root *store.Node, release string) VersionList {
	res := VersionList{Release: release, Entries: []VersionEntry{}}
	addVersions(root, &res.Entries)
	return res
}

func FileVersion(fi store.FileInfo) string {
	return fmt.Sprintf("%x-%x", fi.ModTime.UnixNano(), fi.Size)
}

func addVersions(node *store.Node, into *[]VersionEntry) string {
	if !node.IsDir {
		version := FileVersion(node.FileInfo)
		kind := VersionFile
		if strings.EqualFold(path.Ext(node.Path), ".md") {
			kind = VersionNote
		}
		*into = append(*into, VersionEntry{Path: node.Path, Kind: kind, Version: version})
		return version
	}
	at := len(*into)
	*into = append(*into, VersionEntry{Path: node.Path, Kind: VersionDir})
	sum := sha256.New()
	for _, child := range node.Children {
		version := addVersions(child, into)
		_, _ = fmt.Fprintf(sum, "%s\x00%t\x00%x\x00%s\x00", child.Name, child.IsDir, child.ModTime.UnixNano(), version)
	}
	(*into)[at].Version = hex.EncodeToString(sum.Sum(nil)[:6])
	return (*into)[at].Version
}
