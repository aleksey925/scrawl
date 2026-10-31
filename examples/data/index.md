# Test Notes

Fixture corpus used by `make run` and by the tests. It is deliberately
small but covers every markdown feature the renderer has to handle.

## Pages

- [Guide](guide.md) - tables, code fences, task list, blockquote, details
- [Notes index](notes/index.md) - the directory index
- [Notes overview](notes.md) - a file that shares its name with `notes/`
- [Cyrillic anchors](notes/cyrillic.md) - manual anchors and a TOC
- [Deeply nested page](notes/deep/nested.md)
- [Missing page](does-not-exist.md) - deliberately broken link

## Showcase

- [HTTP caching](showcase/http-caching.md) - every markup element on one
  page, to see how a style change affects reading
- [PlantUML](showcase/plantuml/index.md) - diagrams of many types and
  sizes, the standard library included

## Databases

A folder with no index of its own and four notes:

- [Data storage](db/storage.md) - a long page with an outline
- [Vacuum](db/vacuum.md)
- [Replication](db/replication.md)
- [Locks](db/locks.md)

![Logo](images/logo.png)
