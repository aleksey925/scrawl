// history page: pick a version, read its patch and content, restore one. The
// list itself is server rendered, so the page still lists the versions with
// this module missing; only the detail pane and Restore need scripting.

import {api, confirmDialog, encodePath, esc, openDialog, qs, qsa, toast} from './dom.js';

// the leading characters of a patch line that are not content
const DIFF_META = ['diff --git', 'index ', 'new file', 'deleted file', 'old mode', 'new mode',
    'similarity ', 'rename ', 'copy ', '--- ', '+++ ', 'Binary files'];

function lineClass(line) {
    if (DIFF_META.some((prefix) => line.startsWith(prefix))) return ' is-meta';
    if (line.startsWith('@@')) return ' is-hunk';
    if (line.startsWith('+')) return ' is-add';
    if (line.startsWith('-')) return ' is-del';
    return '';
}

function diffMarkup(patch) {
    return patch.split('\n')
        .map((line) => '<span class="diff-line' + lineClass(line) + '">' + esc(line) + '\n</span>')
        .join('');
}

export function initHistory() {
    const root = qs('#history');
    const detail = qs('#version-detail');
    const rows = qsa('.version', root || document);
    if (!root || !detail || !rows.length) return;

    const path = root.dataset.path || '';
    // the revision the page was built from: the server compares it with what is
    // on disk, so a page left open all day cannot overwrite a newer edit
    const rev = root.dataset.rev || '';
    let pickSeq = 0;

    function render(data) {
        const tail = typeof data.content === 'string'
            ? '<p class="modal-col-title">The document at this version</p>' +
                '<pre class="version-content" data-content></pre>'
            : '';
        detail.innerHTML = '<p class="modal-col-title">What changed</p>' +
            (data.diff
                ? '<pre class="diff" data-diff></pre>'
                : '<p class="empty-hint">This version left no patch for the document.</p>') + tail;
        const patch = qs('[data-diff]', detail);
        if (patch) patch.innerHTML = diffMarkup(data.diff);
        const body = qs('[data-content]', detail);
        if (body) body.textContent = data.content;
    }

    async function show(row) {
        const seq = ++pickSeq;
        detail.setAttribute('aria-busy', 'true');
        // the historical path, which is not today's once a rename sits between
        const url = '/api/history/' + encodePath(row.dataset.path) +
            '?rev=' + encodeURIComponent(row.dataset.rev);
        try {
            const data = await api('GET', url);
            if (seq !== pickSeq) return;
            render(data);
        } catch (err) {
            if (seq !== pickSeq) return;
            detail.innerHTML = '<p class="empty-hint"></p>';
            detail.firstElementChild.textContent = err.message || 'This version could not be read';
        } finally {
            if (seq === pickSeq) detail.setAttribute('aria-busy', 'false');
        }
    }

    function select(row) {
        rows.forEach((other) => {
            other.classList.toggle('is-selected', other === row);
            qs('.version-pick', other).setAttribute('aria-current', String(other === row));
        });
        show(row);
    }

    function showConflict(data) {
        const dlg = openDialog(
            '<h2 class="modal-title">This page changed while the history was open</h2>' +
            '<p class="modal-text">Something wrote to the document after this page was loaded, so ' +
            'nothing was restored. Reload to see where the document stands now, then restore again.</p>' +
            '<p class="modal-col-title">On disk now</p><pre class="modal-pre" data-theirs></pre>' +
            '<div class="modal-actions">' +
            '<button class="btn btn-secondary" type="button" data-act="cancel">Cancel</button>' +
            '<button class="btn btn-primary" type="button" data-act="reload">Reload</button>' +
            '</div>', 'modal modal-wide');
        qs('[data-theirs]', dlg).textContent = data.current_content || '';
        qs('[data-act="cancel"]', dlg).addEventListener('click', () => dlg.close());
        qs('[data-act="reload"]', dlg).addEventListener('click', () => location.reload());
        qs('[data-act="cancel"]', dlg).focus();
    }

    async function restore(row) {
        const when = qs('.version-time', row).textContent.trim();
        const ok = await confirmDialog({
            title: 'Restore this version?',
            text: 'The document is overwritten with the version from ' + when +
                '. The text it has now stays in history and can be restored back.',
            confirmLabel: 'Restore',
            danger: true
        });
        if (!ok) return;
        try {
            await api('POST', '/api/history/restore/' + encodePath(path), {
                rev, version: row.dataset.rev, from: row.dataset.path,
            });
            toast('Restored', 'success');
            location.reload();
        } catch (err) {
            if (err.status === 412 && err.data) {
                showConflict(err.data);
                return;
            }
            toast(err.message || 'Restore failed', 'error');
        }
    }

    rows.forEach((row) => {
        qs('.version-pick', row).addEventListener('click', () => select(row));
        const button = qs('[data-restore]', row);
        if (button) button.addEventListener('click', () => restore(row));
    });
    select(rows[0]);
}
