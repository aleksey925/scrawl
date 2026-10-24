# Storage

How the notes on disk are read, written and watched.

## Access

- Every filesystem operation goes through `store`, which is built on `os.Root`.
  Never join paths against the OS root anywhere else - path traversal has to be
  impossible by construction. The command line is the one exception: it reads
  the files the person running it named, the way any tool does, and a working
  tree only through an `os.Root` of the repository. `site` reads the notes
  through `store` and writes through an `os.Root` of the output.
- Content paths are relative to the space's root, slash-separated, without a
  leading slash. The space is in the URL and never in the path, so `store`
  stays the only security boundary. Markdown URLs keep the `.md` suffix,
  because a file and a directory can share a name (`foo.md` next to `foo/`).
- `.md` is the only document extension, everywhere: the link rewriter, the
  tree, the search index, the editor and the create dialog all ask the same
  question. A `.markdown` file is an attachment like any other and is read
  through `/raw/`.

## Writes

- Writes are atomic: temp file in the same directory, then rename. The temp
  file is opened with `O_CREATE|O_EXCL`, because `os.Root` follows no symlink
  when both are set, so a link planted at the temp path cannot redirect the
  write. The file is synced before the rename and its directory after it:
  without that, a power cut left a renamed file with the right name and no
  content.
- Uploads land in a folder next to the document and named after it
  (`python/notes.md` -> `python/notes/`), which is what the corpus looks like.
  `--upload-dir` replaces that with one shared directory.

## Watching

- A change on disk comes from the watcher as a create as often as a write,
  because an atomic save, from an editor or over SMB, replaces the file, so a
  consumer that listens for writes alone sees no saves. A bare chmod is
  dropped, since on Linux one also comes with a delete. The watcher is
  buffered, so an rsync or a Synology Drive sync does not overflow the inotify
  queue and lose events without a word, and the cached tree still expires on
  its own, because inotify is not reliable on a bind mount or a network share.
