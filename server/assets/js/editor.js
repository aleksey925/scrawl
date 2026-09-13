// markdown editor: a plain textarea plus a toolbar, a server rendered preview,
// drafts in localStorage and an explicit conflict flow. Trailing whitespace is
// never trimmed: the corpus uses whitespace only lines to continue lists.

import {
    api, confirmDialog, debounce, dirOf, encodePath, esc, formatBytes, isMac,
    openDialog, qs, qsa, rememberRev, savedToast, toast
} from './dom.js';
import {enhanceCode} from './reader.js';
import {initDiagrams} from './diagram.js';
import {initMath} from './math.js';

const PREVIEW_DELAY = 400;
const DRAFT_DELAY = 800;
const DRAFT_MAX_AGE = 30 * 24 * 3600 * 1000;
const INDENT = '    ';

function caretOffset(x, y) {
    if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        return pos ? pos.offset : null;
    }
    if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        return range ? range.startOffset : null;
    }
    return null;
}

export function initEditor() {
    const shell = qs('#editor');
    const ta = qs('#editor-source');
    if (!shell || !ta) return;

    const path = shell.dataset.path || '';
    const draftKey = 'scrawl.draft.' + path;
    let rev = shell.dataset.rev || '';
    let saved = ta.value;
    let dirty = false;
    let tabEscapes = false;
    let saving = false;
    const uploads = new Set();

    /* --- text mutation -------------------------------------------------- */

    // execCommand keeps the native undo stack and iOS scroll to caret alive,
    // assigning to value destroys both, so it is only the fallback
    function replace(start, end, text, selStart, selEnd) {
        ta.focus();
        ta.setSelectionRange(start, end);
        let ok = false;
        try {
            ok = document.execCommand('insertText', false, text);
        } catch (e) {
            ok = false;
        }
        if (!ok) {
            ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
        }
        const from = selStart === undefined ? start + text.length : selStart;
        ta.setSelectionRange(from, selEnd === undefined ? from : selEnd);
        onInput();
    }

    function lineBounds(pos) {
        const value = ta.value;
        const start = value.lastIndexOf('\n', pos - 1) + 1;
        let end = value.indexOf('\n', pos);
        if (end < 0) end = value.length;
        return [start, end];
    }

    function selectedLines() {
        const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
        let end = ta.value.indexOf('\n', ta.selectionEnd);
        if (end < 0) end = ta.value.length;
        return [start, end];
    }

    function inFence(pos) {
        const before = ta.value.slice(0, pos).split('\n');
        let open = false;
        for (const line of before) {
            if (/^\s*```/.test(line)) open = !open;
        }
        return open;
    }

    function wrap(marker, placeholder) {
        const {selectionStart: start, selectionEnd: end} = ta;
        const text = ta.value.slice(start, end);
        if (text) {
            const stripped = text.startsWith(marker) && text.endsWith(marker) &&
                text.length >= marker.length * 2;
            if (stripped) {
                replace(start, end, text.slice(marker.length, text.length - marker.length),
                    start, end - marker.length * 2);
                return;
            }
            replace(start, end, marker + text + marker, start + marker.length, end + marker.length);
            return;
        }
        const body = placeholder || '';
        replace(start, end, marker + body + marker,
            start + marker.length, start + marker.length + body.length);
    }

    function eachLine(transform) {
        const [start, end] = selectedLines();
        const lines = ta.value.slice(start, end).split('\n');
        const next = transform(lines).join('\n');
        replace(start, end, next, start, start + next.length);
    }

    const ACTIONS = {
        bold: () => wrap('**', 'bold text'),
        italic: () => wrap('*', 'italic text'),
        code: () => wrap('`', 'code'),
        fence: () => {
            const {selectionStart: start, selectionEnd: end} = ta;
            const text = ta.value.slice(start, end);
            const lead = start > 0 && ta.value[start - 1] !== '\n' ? '\n' : '';
            const block = lead + '```\n' + (text || '') + '\n```\n';
            replace(start, end, block, start + lead.length + 3, start + lead.length + 3);
        },
        heading: () => eachLine((lines) => lines.map((line) => {
            const match = /^(#{1,5})\s+/.exec(line);
            if (!match) return '# ' + line;
            if (match[1].length >= 5) return line.slice(match[0].length);
            return '#'.repeat(match[1].length + 1) + ' ' + line.slice(match[0].length);
        })),
        quote: () => eachLine((lines) => {
            const all = lines.every((line) => /^>\s?/.test(line));
            return lines.map((line) => all ? line.replace(/^>\s?/, '') : '> ' + line);
        }),
        bullet: () => eachLine((lines) => {
            const all = lines.every((line) => /^\s*-\s+/.test(line));
            return lines.map((line) => all ? line.replace(/^(\s*)-\s+/, '$1') : line.replace(/^(\s*)/, '$1- '));
        }),
        ordered: () => eachLine((lines) => {
            const all = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
            return lines.map((line, i) => all
                ? line.replace(/^(\s*)\d+[.)]\s+/, '$1')
                : line.replace(/^(\s*)/, '$1' + (i + 1) + '. '));
        }),
        rule: () => {
            const pos = ta.selectionEnd;
            const lead = pos > 0 && ta.value[pos - 1] !== '\n' ? '\n' : '';
            replace(pos, pos, lead + '\n---\n\n');
        },
        link: () => {
            const {selectionStart: start, selectionEnd: end} = ta;
            const text = ta.value.slice(start, end) || 'link text';
            const out = '[' + text + '](url)';
            const at = start + out.length - 4;
            replace(start, end, out, at, at + 3);
        },
        image: () => qs('#file-input').click()
    };

    qsa('[data-md]', shell).forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
            const run = ACTIONS[button.dataset.md];
            if (run) run();
        });
    });

    /* --- keyboard ------------------------------------------------------- */

    ta.addEventListener('keydown', (event) => {
        // mid composition Enter and Tab belong to the IME: taking Enter here
        // confirms no candidate and splices a list marker into a half built word
        if (event.isComposing || event.keyCode === 229) return;
        const mod = isMac ? event.metaKey : event.ctrlKey;

        if (event.key === 'Escape') {
            tabEscapes = true;
            return;
        }
        if (event.key === 'Tab' && tabEscapes) {
            tabEscapes = false;
            return;
        }
        tabEscapes = false;

        if (mod && event.key.toLowerCase() === 'b') {
            event.preventDefault();
            ACTIONS.bold();
            return;
        }
        if (mod && event.key.toLowerCase() === 'i') {
            event.preventDefault();
            ACTIONS.italic();
            return;
        }
        if (mod && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            ACTIONS.link();
            return;
        }
        if (mod && event.key.toLowerCase() === 'e') {
            event.preventDefault();
            (event.shiftKey ? ACTIONS.fence : ACTIONS.code)();
            return;
        }
        if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
            event.preventDefault();
            setMode(mode === 'preview' ? 'split' : 'preview', true);
            return;
        }

        if (event.key === 'Tab') {
            event.preventDefault();
            const [start, end] = selectedLines();
            const multiline = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n');
            if (event.shiftKey || multiline) {
                const lines = ta.value.slice(start, end).split('\n');
                const next = lines.map((line) => event.shiftKey
                    ? line.replace(new RegExp('^ {1,' + INDENT.length + '}'), '')
                    : INDENT + line).join('\n');
                replace(start, end, next, start, start + next.length);
                return;
            }
            const pos = ta.selectionStart;
            replace(pos, ta.selectionEnd, INDENT);
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey && !mod) {
            const pos = ta.selectionStart;
            if (pos !== ta.selectionEnd) return;
            const [start, end] = lineBounds(pos);
            const line = ta.value.slice(start, end);
            if (inFence(start)) {
                const indent = /^[ \t]*/.exec(line)[0];
                if (!indent) return;
                event.preventDefault();
                replace(pos, pos, '\n' + indent);
                return;
            }
            const match = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?(\s+)/.exec(line);
            if (match) {
                event.preventDefault();
                if (!line.slice(match[0].length).trim()) {
                    replace(start, end, match[1]);
                    return;
                }
                let marker = match[2];
                if (/^\d/.test(marker)) {
                    marker = (parseInt(marker, 10) + 1) + marker.slice(-1);
                }
                replace(pos, pos, '\n' + match[1] + marker + (match[3] ? ' [ ]' : '') + match[4]);
                return;
            }
            const indent = /^[ \t]*/.exec(line)[0];
            if (indent) {
                event.preventDefault();
                replace(pos, pos, '\n' + indent);
            }
        }
    });

    /* --- preview -------------------------------------------------------- */

    const preview = qs('#preview');
    let previewSeq = 0;
    let previewPending = null;
    // a document may be well inside the save limit and still over the smaller
    // preview one. Asking again on every keystroke only burns the server's
    // throttle, so stop until the text is shorter than what it refused.
    let previewRefusedAt = Infinity;

    const renderPreview = async () => {
        if (!preview || mode === 'source') return;
        if (ta.value.length >= previewRefusedAt) return;
        const seq = ++previewSeq;
        if (previewPending) previewPending.abort();
        previewPending = new AbortController();
        preview.setAttribute('aria-busy', 'true');
        try {
            const data = await api('POST', '/api/preview', {content: ta.value, path},
                {signal: previewPending.signal});
            if (seq !== previewSeq) return;
            preview.innerHTML = (data && data.html) || '';
            enhanceCode(preview);
            initMath(preview);
            initDiagrams(preview);
        } catch (err) {
            if (err.name === 'AbortError' || seq !== previewSeq) return;
            if (err.status === 413) {
                previewRefusedAt = ta.value.length;
                preview.innerHTML = '<p class="empty-hint">This document is too large to preview. ' +
                    'Editing and saving still work.</p>';
                return;
            }
            preview.innerHTML = '<p class="empty-hint">Preview failed: ' + esc(err.message) + '</p>';
        } finally {
            if (seq === previewSeq) preview.setAttribute('aria-busy', 'false');
        }
    };

    const schedulePreview = debounce(renderPreview, PREVIEW_DELAY);

    /* --- drafts and status ---------------------------------------------- */

    const statusCounts = qs('#status-counts');
    const statusState = qs('#status-state');
    const statusBar = qs('.statusbar');
    const dot = qs('[data-dirty-dot]');

    function setStatus(text) {
        // an aria-live region replays the whole string whenever its text node is
        // replaced, so assigning the one already there talks over the typing
        if (statusState && statusState.textContent !== text) statusState.textContent = text;
    }

    // counting bytes copies the whole document, too much for every keystroke of
    // a long note
    function countNow() {
        if (!statusCounts) return;
        const lines = ta.value.split('\n').length;
        statusCounts.textContent = lines + ' lines, ' + formatBytes(new Blob([ta.value]).size);
    }

    const updateCounts = debounce(countNow, 200);

    function updateStatus() {
        updateCounts();
        if (statusBar) statusBar.classList.toggle('is-dirty', dirty);
        if (dot) dot.hidden = !dirty;
    }

    function writeDraft() {
        if (!dirty) return;
        try {
            localStorage.setItem(draftKey, JSON.stringify({rev, content: ta.value, at: Date.now()}));
        } catch (e) {
            // storage full or disabled, the draft simply is not kept
        }
    }

    const saveDraft = debounce(writeDraft, DRAFT_DELAY);

    function clearDraft() {
        try {
            localStorage.removeItem(draftKey);
        } catch (e) {
            // nothing to clean up
        }
    }

    function onInput() {
        dirty = ta.value !== saved;
        updateStatus();
        setStatus(dirty ? 'Unsaved changes' : 'Saved');
        saveDraft();
        schedulePreview();
    }

    ta.addEventListener('input', onInput);

    // a draft nobody came back to finish is not worth keeping, and the ones
    // whose page has since moved on would otherwise sit in storage forever
    function pruneDrafts() {
        try {
            Object.keys(localStorage)
                .filter((key) => key.startsWith('scrawl.draft.'))
                .forEach((key) => {
                    const at = (JSON.parse(localStorage.getItem(key) || 'null') || {}).at || 0;
                    if (Date.now() - at > DRAFT_MAX_AGE) localStorage.removeItem(key);
                });
        } catch (e) {
            // storage disabled, there is nothing to sweep
        }
    }

    function offerDraft() {
        let stored = null;
        try {
            stored = JSON.parse(localStorage.getItem(draftKey) || 'null');
        } catch (e) {
            stored = null;
        }
        if (!stored || stored.content === ta.value) return;
        // a draft written against an older rev is still the reader's own unsaved
        // text. Dropping it silently loses work; it is offered and labelled.
        const stale = stored.rev !== rev;
        const bar = qs('#draft-bar');
        const when = new Date(stored.at || Date.now());
        qs('#draft-text').textContent = 'An unsaved draft from ' +
            when.toLocaleString([], {hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'}) +
            (stale ? ' was found, written against an older version of this page.' : ' was found.');
        bar.hidden = false;
        qs('[data-draft-restore]').addEventListener('click', () => {
            // through replace, so restoring stays on the native undo stack
            replace(0, ta.value.length, stored.content);
            bar.hidden = true;
        });
        qs('[data-draft-discard]').addEventListener('click', () => {
            clearDraft();
            bar.hidden = true;
        });
    }

    /* --- saving and conflicts ------------------------------------------- */

    async function put(body, targetPath) {
        return api('PUT', '/api/file/' + encodePath(targetPath || path), body);
    }

    const saveButtons = qsa('[data-editor-save]');

    function setSaving(on) {
        saving = on;
        saveButtons.forEach((button) => {
            button.disabled = on;
        });
    }

    // the text is kept here and in the draft, so what the reader needs is a way
    // back in that does not cost them the buffer they are standing in
    function sessionExpired() {
        writeDraft();
        const dlg = openDialog(
            '<h2 class="modal-title">Your session expired</h2>' +
            '<p class="modal-text">Nothing was saved. Your text is still here, and kept as a local ' +
            'draft. Sign in again in the new tab, then come back and save.</p>' +
            '<div class="modal-actions">' +
            '<button class="btn btn-secondary" type="button" data-act="cancel">Not now</button>' +
            '<button class="btn btn-primary" type="button" data-act="login">Sign in</button>' +
            '</div>');
        qs('[data-act="cancel"]', dlg).addEventListener('click', () => dlg.close());
        qs('[data-act="login"]', dlg).addEventListener('click', () => {
            window.open('/login?from=' + encodeURIComponent(location.pathname), '_blank', 'noopener');
            dlg.close();
        });
        qs('[data-act="cancel"]', dlg).focus();
    }

    // the request body is a snapshot. Anything typed while it was in flight was
    // never sent, so the baseline moves to what went out rather than to what the
    // box holds now, and the draft stays until nothing is left over.
    function markSaved(sent) {
        saved = sent;
        dirty = ta.value !== sent;
        if (!dirty) clearDraft();
        rememberRev(path, rev);
        updateStatus();
        setStatus(dirty ? 'Unsaved changes' : 'Saved');
    }

    async function save() {
        // a second click would send the same rev again, and it comes back as a
        // conflict for a save that in fact went through
        if (saving) return;
        if (!dirty) {
            toast('Nothing to save');
            return;
        }
        setSaving(true);
        let sent = '';
        try {
            // an upload still in flight has its ![](uploading-xxx) token sitting
            // in the text, and saving now writes that placeholder to disk as the
            // document, with the real link arriving too late to be saved
            if (uploads.size) {
                setStatus('Waiting for the upload');
                await Promise.allSettled(Array.from(uploads));
            }
            setStatus('Saving');
            sent = ta.value;
            const res = await put({content: sent, rev});
            rev = (res && res.rev) || rev;
            shell.dataset.rev = rev;
            markSaved(sent);
            savedToast(res, 'Saved');
        } catch (err) {
            if ((err.status === 412 || err.status === 409) && err.data) {
                // a response lost on the way back leaves the write done and this
                // editor a revision behind, so the retry collides with its own
                // text. Identical content means the save already landed, and
                // showing a conflict for it would be alarming and wrong.
                if (err.data.current_content === sent) {
                    rev = err.data.current_rev || rev;
                    shell.dataset.rev = rev;
                    markSaved(sent);
                    savedToast(err.data, 'Saved');
                    return;
                }
                setStatus('Conflict');
                showConflict(err.data);
                return;
            }
            setStatus('Not saved');
            if (err.status === 401) {
                sessionExpired();
                return;
            }
            toast(err.message || 'Save failed', 'error');
        } finally {
            setSaving(false);
        }
    }

    function showConflict(data) {
        const dlg = openDialog(
            '<h2 class="modal-title">This file changed on disk</h2>' +
            '<p class="modal-text">Someone or something else wrote to this file after you started editing.</p>' +
            '<div class="modal-cols">' +
            '<div><p class="modal-col-title">Your version</p><pre class="modal-pre" data-mine></pre></div>' +
            '<div><p class="modal-col-title">On disk</p><pre class="modal-pre" data-theirs></pre></div>' +
            '</div>' +
            '<div class="modal-actions">' +
            '<button class="btn btn-secondary" type="button" data-act="cancel">Cancel</button>' +
            '<button class="btn btn-secondary" type="button" data-act="copy">Save as copy</button>' +
            '<button class="btn btn-danger" type="button" data-act="overwrite">Overwrite</button>' +
            '</div>', 'modal modal-wide');
        qs('[data-mine]', dlg).textContent = ta.value;
        qs('[data-theirs]', dlg).textContent = data.current_content || '';
        qs('[data-act="cancel"]', dlg).focus();
        qs('[data-act="cancel"]', dlg).addEventListener('click', () => dlg.close());

        qs('[data-act="overwrite"]', dlg).addEventListener('click', async () => {
            dlg.close();
            const sent = ta.value;
            try {
                const res = await put({content: sent, rev: data.current_rev || ''});
                rev = (res && res.rev) || rev;
                shell.dataset.rev = rev;
                markSaved(sent);
                savedToast(res, 'Saved over the disk version');
            } catch (err) {
                toast(err.message || 'Save failed', 'error');
            }
        });

        qs('[data-act="copy"]', dlg).addEventListener('click', async () => {
            dlg.close();
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const copyPath = path.replace(/\.md$/, '') + '.conflict-' + stamp + '.md';
            try {
                await put({content: ta.value, rev: ''}, copyPath);
                dirty = false;
                clearDraft();
                location.href = '/edit/' + encodePath(copyPath);
            } catch (err) {
                toast(err.message || 'Could not save the copy', 'error');
            }
        });
    }

    saveButtons.forEach((b) => b.addEventListener('click', save));

    // on the document rather than the text area: with the caret in the preview
    // pane or on the splitter this would otherwise be the browser's save dialog
    document.addEventListener('keydown', (event) => {
        const mod = isMac ? event.metaKey : event.ctrlKey;
        if (!mod || event.shiftKey || event.altKey || event.key.toLowerCase() !== 's') return;
        event.preventDefault();
        save();
    });

    /* --- leaving the page ----------------------------------------------- */

    window.addEventListener('beforeunload', (event) => {
        if (!dirty) return;
        // the debounced draft may still be pending, and the prompt this raises
        // blocks the timer that would have written it
        writeDraft();
        event.preventDefault();
        event.returnValue = '';
    });

    // beforeunload does not fire when a phone backgrounds the tab and the system
    // later reclaims it, pagehide does
    window.addEventListener('pagehide', writeDraft);

    document.addEventListener('click', async (event) => {
        const link = event.target.closest('a[href]');
        if (!dirty || !link || link.target === '_blank' || link.hasAttribute('data-palette-open')) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || url.pathname === location.pathname) return;
        event.preventDefault();
        // nav.js navigates a folder row itself, from a bubble listener that
        // preventDefault does not reach: without this the page leaves while the
        // dialog is still on screen waiting for an answer
        event.stopPropagation();
        const leave = await confirmDialog({
            title: 'Leave without saving?',
            text: 'Your changes are kept as a local draft, but they are not written to disk.',
            confirmLabel: 'Leave',
            danger: true
        });
        if (leave) {
            writeDraft();
            dirty = false;
            location.href = url.href;
        }
    }, true);

    /* --- layout modes and the splitter ---------------------------------- */

    let mode = 'split';

    // remember marks the reader's own choice. The boot default is derived from
    // the window width, and storing that turns one edit on a phone into a
    // desktop that quietly lost its split view.
    function setMode(next, remember) {
        mode = next;
        shell.classList.remove('mode-source', 'mode-split', 'mode-preview');
        shell.classList.add('mode-' + next);
        qsa('[data-view-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewMode === next)));
        qsa('[data-pane-tab]').forEach((b) => b.setAttribute('aria-selected',
            String((b.dataset.paneTab === 'preview') === (next === 'preview'))));
        if (remember) {
            try {
                localStorage.setItem('scrawl.editor.mode', next);
            } catch (e) {
                // not remembering the mode is fine
            }
        }
        if (next !== 'source') renderPreview();
    }

    qsa('[data-view-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.viewMode, true)));
    qsa('[data-pane-tab]').forEach((b) => b.addEventListener('click', () => {
        setMode(b.dataset.paneTab === 'preview' ? 'preview' : 'source', true);
    }));

    const splitter = qs('#splitter');
    const panes = qs('#panes');
    if (splitter && panes) {
        const applySplit = (fraction) => panes.style.setProperty('--split', (fraction * 100) + '%');
        let stored = 0.5;
        try {
            stored = parseFloat(localStorage.getItem('scrawl.editor.split')) || 0.5;
        } catch (e) {
            stored = 0.5;
        }
        applySplit(stored);
        const onMove = (event) => {
            const rect = panes.getBoundingClientRect();
            const fraction = Math.min(0.8, Math.max(0.2, (event.clientX - rect.left) / rect.width));
            applySplit(fraction);
            try {
                localStorage.setItem('scrawl.editor.split', String(fraction));
            } catch (e) {
                // ignore
            }
        };
        splitter.addEventListener('pointerdown', (event) => {
            splitter.setPointerCapture(event.pointerId);
            splitter.addEventListener('pointermove', onMove);
        });
        const endDrag = (event) => {
            splitter.releasePointerCapture(event.pointerId);
            splitter.removeEventListener('pointermove', onMove);
        };
        splitter.addEventListener('pointerup', endDrag);
        // the browser can claim the gesture, and then no pointerup ever arrives
        splitter.addEventListener('pointercancel', endDrag);
        splitter.addEventListener('keydown', (event) => {
            const rect = panes.getBoundingClientRect();
            const now = (parseFloat(panes.style.getPropertyValue('--split')) || 50) / 100;
            if (event.key === 'ArrowLeft') applySplit(Math.max(0.2, now - 40 / rect.width));
            if (event.key === 'ArrowRight') applySplit(Math.min(0.8, now + 40 / rect.width));
        });
    }

    // proportional scroll sync, good enough without source maps in the renderer
    let syncing = false;
    const pane = qs('.pane-preview');
    ta.addEventListener('scroll', () => {
        if (syncing || !pane || mode !== 'split') return;
        syncing = true;
        const max = ta.scrollHeight - ta.clientHeight;
        const ratio = max > 0 ? ta.scrollTop / max : 0;
        pane.scrollTop = ratio * (pane.scrollHeight - pane.clientHeight);
        requestAnimationFrame(() => {
            syncing = false;
        });
    }, {passive: true});

    /* --- image upload --------------------------------------------------- */

    // save has to know an upload is outstanding, so every one of them is tracked
    // for as long as its placeholder is still standing in the document
    async function upload(file) {
        const job = uploadFile(file);
        uploads.add(job);
        try {
            await job;
        } finally {
            uploads.delete(job);
        }
    }

    async function uploadFile(file) {
        const token = 'uploading-' + Math.random().toString(36).slice(2, 8);
        const at = ta.selectionStart;
        replace(at, ta.selectionEnd, '![](' + token + ')');
        const form = new FormData();
        form.append('file', file);
        const url = '/api/upload/' + encodePath(dirOf(path)) +
            '?doc=' + encodeURIComponent(path);
        // replace has to focus the text area for execCommand to apply, so an
        // upload that lands while the reader is elsewhere puts them back
        const swap = (text) => {
            const active = document.activeElement;
            const spot = ta.value.indexOf('![](' + token + ')');
            if (spot >= 0) replace(spot, spot + token.length + 5, text);
            if (active && active !== ta && active.isConnected) active.focus();
        };
        try {
            const res = await fetch(url, {method: 'POST', body: form});
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'upload failed');
            const data = await res.json();
            swap(data.markdown || ('![](' + data.path + ')'));
            savedToast(data, 'Image uploaded');
        } catch (err) {
            swap('');
            toast(err.message || 'Upload failed', 'error');
        }
    }

    ta.addEventListener('paste', (event) => {
        const data = event.clipboardData;
        const files = Array.from((data && data.files) || []);
        if (!files.length) return;
        // Word and Excel put a screenshot on the clipboard beside the text, and
        // uploading that picture instead of pasting the text is never the intent
        if (Array.from(data.types || []).includes('text/plain')) return;
        event.preventDefault();
        files.forEach(upload);
    });

    ['dragenter', 'dragover'].forEach((name) => ta.addEventListener(name, (event) => {
        event.preventDefault();
        ta.classList.add('is-dropping');
    }));
    ['dragleave', 'dragend', 'drop'].forEach((name) => ta.addEventListener(name, () => {
        ta.classList.remove('is-dropping');
    }));
    ta.addEventListener('drop', (event) => {
        const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
        if (!files.length) return;
        event.preventDefault();
        // dragover is preventDefault()ed, so the browser never moved the caret
        // to where the file landed and the markdown would go wherever it was
        const at = caretOffset(event.clientX, event.clientY);
        if (at !== null) ta.setSelectionRange(at, at);
        files.forEach(upload);
    });

    const picker = qs('#file-input');
    if (picker) {
        picker.addEventListener('change', () => {
            Array.from(picker.files || []).forEach(upload);
            picker.value = '';
        });
    }

    /* --- iOS keyboard --------------------------------------------------- */

    // WebKit unpins fixed elements when the keyboard opens and fires no resize,
    // so put the caret line a third of the way down before the keyboard animates
    // in, which leaves Safari's own reveal scroll with nothing to do
    const softKeyboard = window.matchMedia('(hover: none)').matches;
    ta.addEventListener('focus', () => {
        if (!softKeyboard || ta.scrollHeight <= ta.clientHeight) return;
        const total = ta.value.split('\n').length;
        const line = ta.value.slice(0, ta.selectionStart).split('\n').length;
        ta.scrollTop = Math.max(0, line * (ta.scrollHeight / total) - ta.clientHeight / 3);
    });

    const dismiss = qs('[data-kb-dismiss]');
    if (dismiss) dismiss.addEventListener('click', () => ta.blur());

    /* --- boot ----------------------------------------------------------- */

    let start = 'split';
    try {
        start = localStorage.getItem('scrawl.editor.mode') || 'split';
    } catch (e) {
        start = 'split';
    }
    setMode(window.innerWidth < 900 ? 'source' : start);
    pruneDrafts();
    offerDraft();
    updateStatus();
    countNow();
    setStatus(shell.dataset.new === '1' ? 'New page' : 'Saved');
    // on a phone an autofocus opens the keyboard over half the document
    if (!softKeyboard) {
        ta.setSelectionRange(0, 0);
        ta.focus();
    }
}
