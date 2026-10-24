# 16. The split panes follow by pixel pairs, not by source line

Status: accepted. Where it applies:
[editor position](../design/editor-position.md#split-panes).

## Context

In the split editor the pane the reader is not working in follows the other.

## Decision

The follower is placed by interpolating between measured pixel pairs: the top
and bottom of every rendered block, with the document ends around them. The
pairs are measured once per layout.

## Options turned down

- Place the follower by way of a source line. A line is a step a paragraph
  wide: the pane stood still for a few frames and then hopped.
