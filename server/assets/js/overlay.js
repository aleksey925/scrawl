// one owner for the panels that cover the page: the sidebar drawer and the
// outline sheet. Each used to run its own copy of the same mechanics over its
// own overlapping set of elements, so closing one lifted the inert the other
// had set, and a close that did not go through the panel's own teardown left
// the page inert with nothing on screen saying why.

import {qsa} from './dom.js';

// everything a panel covers. The panel itself and whatever opens it are exempt:
// the trigger has to stay live, because on a phone it is also how it closes.
const COVERED = '.topbar, .main, .sidebar, .toc-rail, .toc-pill';

let open = null;

function cover(keep) {
    qsa(COVERED).forEach((el) => {
        const exempt = keep.some((node) => node && (node === el || node.contains(el) || el.contains(node)));
        if (!exempt) el.setAttribute('inert', '');
    });
}

function uncover() {
    qsa(COVERED).forEach((el) => el.removeAttribute('inert'));
}

export function overlayOpen(name) {
    return !!open && open.name === name;
}

// openOverlay puts one panel up and takes down whatever was up before it. keep
// lists what stays reachable behind it, close is the caller's own teardown.
export function openOverlay(name, {keep = [], focus = null, close}) {
    if (open) closeOverlay(open.name);
    open = {name, close, restoreTo: document.activeElement};
    cover(keep);
    if (focus) focus.focus();
}

export function closeOverlay(name) {
    if (!open || open.name !== name) return;
    const was = open;
    // cleared before the teardown runs, so a close() that asks what is open
    // gets the answer it will have once it returns rather than its own name
    open = null;
    uncover();
    was.close();
    if (was.restoreTo && was.restoreTo.isConnected) was.restoreTo.focus();
}
