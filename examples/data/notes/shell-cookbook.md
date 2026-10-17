# Shell cookbook

A long page on purpose: it is the fixture the browser suite scrolls when
it checks that opening the editor lands where the reader was looking.

Back to the [index](../index.md).

## Moving around

`cd -` returns to the previous directory, which is the fastest way to
bounce between two trees without typing either path again.

```bash
cd /var/log/nginx
cd /etc/nginx
cd -          # back to /var/log/nginx
cd -          # and back again
```

`pushd` and `popd` keep a stack when two directories are not enough.

```bash
pushd /tmp
pushd /etc
dirs -v
popd
```

## Finding files

`find` is the tool that always works, even when the fast ones are not
installed.

```bash
find . -name '*.log' -mtime +7 -delete
find . -type d -empty -print
find . -type f -size +100M -exec ls -lh {} +
```

Prefer `-exec ... +` over `-exec ... \;`: the first form batches the
arguments into as few calls as possible, the second starts one process
per file.

### Skipping directories

```bash
find . -path ./node_modules -prune -o -name '*.ts' -print
```

The `-prune` has to come before the `-o`, otherwise find descends into
the directory anyway and only then decides not to print it.

## Finding text

```bash
grep -rn 'TODO' --include='*.go' .
grep -rl 'package main' .          # names only
grep -c '^' file.txt               # count lines, including the last unterminated one
```

`grep -c '^'` is worth remembering: `wc -l` counts newline characters,
so a file whose last line has no trailing newline comes out one short.

| flag | meaning |
| ---- | ------- |
| `-r` | recurse into directories |
| `-n` | show line numbers |
| `-l` | list matching file names only |
| `-i` | case insensitive |
| `-v` | invert the match |
| `-F` | treat the pattern as a fixed string |

## Pipes and process substitution

Comparing two commands without temporary files:

```bash
diff <(sort a.txt) <(sort b.txt)
comm -13 <(sort a.txt) <(sort b.txt)
```

Reading a command into a loop without a subshell, so variables set
inside the loop survive it:

```bash
while read -r line; do
    count=$((count + 1))
done < <(grep -v '^#' config.txt)
echo "$count"
```

The usual `grep ... | while read` form puts the loop in a subshell and
the count is gone the moment the pipe closes.

## Quoting

The single rule that removes most shell bugs: quote every expansion.

```bash
rm -rf "$dir"          # right
rm -rf $dir            # one space in the value and this deletes the wrong thing
```

Arrays keep arguments separate when the values contain spaces.

```bash
args=(--root "$HOME/my notes" --listen :7272)
scrawl "${args[@]}"
```

`"${args[@]}"` expands to one word per element. `"${args[*]}"` joins
them into a single word, which is almost never what you want.

## Exit codes and errors

```bash
set -euo pipefail
```

- `-e` stops on the first failing command
- `-u` treats an unset variable as an error
- `-o pipefail` makes a pipeline fail if any stage fails, not just the last

Without `pipefail`, `false | true` succeeds, which hides a failure in
the middle of a pipeline.

### Trapping cleanup

```bash
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
```

`EXIT` fires on a normal return and on most signals, so one trap covers
the ordinary cases without listing them.

## Text processing

```bash
awk '{sum += $2} END {print sum}' data.txt
awk -F: '$3 >= 1000 {print $1}' /etc/passwd
sed 's/old/new/g' file.txt
sed -n '10,20p' file.txt
```

Cutting columns out of whitespace-separated output:

```bash
ps aux | awk '{print $2, $11}'
```

`cut` works when the separator is a single character, `awk` when runs of
whitespace count as one.

## Dates

```bash
date +%Y-%m-%d
date -u +%Y-%m-%dT%H:%M:%SZ
date -d '7 days ago' +%Y-%m-%d
```

Sorting file names that carry a date works only when the date is written
largest unit first, which is the real argument for ISO 8601 everywhere.

## Archives

```bash
tar czf notes.tar.gz notes/
tar xzf notes.tar.gz
tar tzf notes.tar.gz | head
```

Always list an archive before extracting one you did not make: an
archive whose members carry absolute paths or `..` will write outside
the directory you are standing in.

## Disk usage

```bash
du -sh ./*             # size of each entry here
du -sh ./* | sort -h   # largest last
df -h                  # free space per filesystem
```

`sort -h` understands the `K`, `M`, `G` suffixes that `du -h` prints, so
the two belong together.

## Networking

```bash
curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' https://example.com
curl -I https://example.com
ss -ltnp
```

`-sS` is the useful pair: `-s` silences the progress meter and `-S` puts
the errors back, so a failure is still visible.

## Permissions

```bash
chmod 644 file          # rw-r--r--
chmod 755 dir           # rwxr-xr-x
chmod -R u+rwX,go+rX .  # capital X sets +x on directories only
```

The capital `X` is the one worth knowing: it adds the execute bit to
directories and to files that already had one, and leaves ordinary files
alone.

## Processes

```bash
jobs
bg %1
fg %1
kill -TERM 1234
kill -KILL 1234
```

Send `TERM` first and give the process a moment. `KILL` cannot be caught,
so nothing gets a chance to flush or clean up after itself.

## History

```bash
history | grep docker
!!            # the previous command
!$            # the last argument of the previous command
```

`sudo !!` after a permission error reruns the same line with sudo, which
is the single most used two-character trick in the list.

## When to stop

A shell script that has grown past a page of argument parsing, or that
needs a data structure, has outgrown the shell. Rewriting it in Python
or Go is almost always cheaper than the next bug in it.
