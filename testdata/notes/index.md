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

## Базы данных

Папка без своего индекса, четыре документа на русском языке:

- [Хранение данных](db/storage.md) - длинная страница с оглавлением
- [Очистка](db/vacuum.md)
- [Репликация](db/replication.md)
- [Блокировки](db/locks.md)

![Logo](images/logo.png)
