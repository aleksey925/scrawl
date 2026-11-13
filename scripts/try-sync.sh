#!/usr/bin/env bash
# Try the sync states of a space that is a git clone, on this machine only.
#
# Terminal 1, from the project root:
#
#   scripts/try-sync.sh start
#
# It makes a fresh test remote in /tmp/scrawl-try, runs scrawl from this
# checkout and keeps running. Open http://localhost:7272/s/notes/note.md
# and click the cloud at the top right: Synced.
#
# Terminal 2, one command at a time:
#
#   scripts/try-sync.sh offline    the remote is gone and a note is saved
#                                   only here: Not synced
#   scripts/try-sync.sh online     the remote is back, the change is sent:
#                                   Synced again
#   scripts/try-sync.sh remote     a change arrives from the remote: reload
#                                   the page to see the new text
#   scripts/try-sync.sh conflict   both sides change the note: Conflict, the
#                                   banner and Replace local copy
#
# scrawl needs no restart between steps: the script asks it to fetch through
# the webhook. Run start again for a clean slate. Another port or folder:
# TRY_PORT=7300 TRY_DIR=/tmp/other, the same for every command. start removes
# only a folder it made itself, one that holds spaces.yml.
set -euo pipefail

dir=${TRY_DIR:-/tmp/scrawl-try}
port=${TRY_PORT:-7272}
base="http://127.0.0.1:$port/s/notes"
secret=try-sync-hook-secret-of-at-least-32-bytes
root=$(cd "$(dirname "$0")/.." && pwd)

usage() {
    sed -n '2,/^set /s/^# \{0,1\}//p' "$0"
}

commit() {
    git -C "$1" -c user.name=try -c user.email=try@localhost commit -q -am "$2"
}

fetch() {
    curl -fsS -o /dev/null -X POST -H "X-Gitlab-Token: $secret" "$base/hook"
}

save() {
    local rev
    rev=$(curl -fsS "$base/api/file/note.md" | grep -o '"rev":"[^"]*"' | cut -d'"' -f4)
    curl -fsS -o /dev/null -X PUT \
        -H 'Content-Type: application/json' \
        -H "Origin: http://127.0.0.1:$port" \
        -H 'Sec-Fetch-Site: same-origin' \
        -d "{\"content\":\"# Note\\n\\n$1\\n\",\"rev\":\"$rev\"}" \
        "$base/api/file/note.md"
}

push_remote() {
    rm -rf "$dir/other"
    git clone -q "$dir/origin.git" "$dir/other"
    printf '# Note\n\n%s\n' "$1" >"$dir/other/note.md"
    commit "$dir/other" "$1"
    git -C "$dir/other" push -q origin main
}

online() {
    if [ -d "$dir/origin.gone" ]; then
        mv "$dir/origin.gone" "$dir/origin.git"
    fi
}

start() {
    if [ -e "$dir" ] && [ ! -f "$dir/spaces.yml" ]; then
        echo "$dir exists and is not a try-sync folder, so it is not removed" >&2
        exit 1
    fi
    rm -rf "$dir"
    mkdir -p "$dir"
    git init -q --bare -b main "$dir/origin.git"
    git clone -q "$dir/origin.git" "$dir/seed" 2>/dev/null
    printf '# Note\n\nThe first text.\n' >"$dir/seed/note.md"
    git -C "$dir/seed" add -A
    commit "$dir/seed" seed
    git -C "$dir/seed" push -q origin main
    rm -rf "$dir/seed"
    cat >"$dir/spaces.yml" <<EOF
spaces:
  - name: notes
    dir: $dir/clone
    repo:
      url: $dir/origin.git
      branch: main
      hook_secret_env: TRY_SYNC_HOOK
EOF
    echo "open http://localhost:$port/s/notes/note.md"
    cd "$root"
    TRY_SYNC_HOOK=$secret SPACES_FILE="$dir/spaces.yml" AUTH_DISABLED=true \
        LISTEN="127.0.0.1:$port" AUTH_SECRET_FILE="$dir/session.key" exec go run . serve
}

case "${1:-}" in
start) start ;;
offline)
    if [ -d "$dir/origin.git" ]; then
        mv "$dir/origin.git" "$dir/origin.gone"
    fi
    save "Changed here while the remote is away."
    echo "Not synced: the save stays here until the remote is back"
    ;;
online)
    online
    fetch
    echo "the remote is back: the saved change is sent"
    ;;
remote)
    online
    push_remote "Changed on the remote at $(date +%H:%M:%S)."
    fetch
    echo "the remote changed: reload the note to see the new text"
    ;;
conflict)
    online
    push_remote "Changed on the remote."
    save "Changed here."
    fetch
    echo "Conflict: the banner offers Replace local copy"
    ;;
*) usage ;;
esac
