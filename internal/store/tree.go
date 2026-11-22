package store

import (
	"errors"
	"time"
)

type Node struct {
	FileInfo
	Children []*Node
}

func (s *Store) Tree() (*Node, error) {
	s.treeMu.Lock()
	defer s.treeMu.Unlock()

	if s.tree == nil || s.treeDirty || time.Since(s.treeAt) > s.cfg.TreeTTL {
		root, err := s.buildTree(".")
		if err != nil {
			return nil, err
		}
		s.tree, s.treeAt, s.treeDirty = root, time.Now(), false
	}
	return s.tree.clone(), nil
}

func (s *Store) invalidate() {
	s.treeMu.Lock()
	s.treeDirty = true
	s.treeMu.Unlock()
}

func (s *Store) buildTree(cleaned string) (*Node, error) {
	fi, err := s.root.Lstat(cleaned)
	if err != nil {
		return nil, osError("tree", displayPath(cleaned), err)
	}
	node := &Node{FileInfo: info(cleaned, fi)}

	entries, err := s.list(cleaned)
	if err != nil {
		return nil, err
	}
	node.Children = make([]*Node, 0, len(entries))
	for _, ent := range entries {
		if !ent.IsDir {
			node.Children = append(node.Children, &Node{FileInfo: ent})
			continue
		}
		sub, subErr := s.buildTree(ent.Path)
		if subErr != nil {
			if errors.Is(subErr, ErrNotFound) {
				continue
			}
			return nil, subErr
		}
		node.Children = append(node.Children, sub)
	}
	return node, nil
}

func (n *Node) InNavTree() bool {
	return n.IsDir || isMarkdown(n.Path)
}

func (n *Node) clone() *Node {
	if n == nil {
		return nil
	}
	res := &Node{FileInfo: n.FileInfo}
	if len(n.Children) > 0 {
		res.Children = make([]*Node, len(n.Children))
		for i, sub := range n.Children {
			res.Children[i] = sub.clone()
		}
	}
	return res
}
