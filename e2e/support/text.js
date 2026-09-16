// every string of the interface a spec asserts on, in one place, so a wording
// change is one edit here instead of a hunt through the specs

module.exports = {
    // the editor status line, which carries the same word as data-state
    status: {
        saved: 'Saved',
        dirty: 'Unsaved changes',
        // a page created in this session keeps saying "New page": the editor is
        // told it is new when the route loads and never asked again
        new: 'New page',
        saving: 'Saving',
        uploading: 'Waiting for the upload',
    },

    // modal titles, which is what names the dialog a spec opened
    modal: {
        newPage: 'New page',
        newFolder: 'New folder',
        rename: 'Rename or move',
        deletePage: 'Delete page?',
        deleteFolder: 'Delete folder?',
        leave: 'Leave without saving?',
        conflict: 'This file changed on disk',
        restore: 'Restore this version?',
        restoreConflict: 'This page changed while the history was open',
        session: 'Your session expired',
    },

    toast: {
        saved: 'Saved',
        restored: 'Restored',
        folderCreated: 'Folder created',
        renamed: 'Renamed',
        deleted: 'Deleted',
        notDeleted: 'Nothing was deleted',
        folderNotEmpty: 'The folder is not empty',
        imageUploaded: 'Image uploaded',
        linkCopied: 'Link copied',
    },

    // inline validation, which the create dialog shows on the field rather than
    // as a toast: closing first would throw away the typed name and the folder
    pageExists: 'That page already exists',
    folderExists: 'That folder already exists',

    doc: {
        missing: 'This note does not exist yet.',
        create: 'Create it',
        edit: 'Edit',
        history: 'History',
    },

    dir: {
        empty: 'This folder is empty.',
    },

    search: {
        empty: 'No notes match that.',
        prompt: 'Type a query to search every note.',
        // the count reads "3 results in 1 ms", so a spec asserts the number
        // through data-total and only the unit here
        results: 'results',
    },

    sidebar: {
        newPage: 'New page',
        newFolder: 'New folder',
        nothingMatches: 'Nothing matches. Press Enter to search the text of every note.',
    },

    history: {
        title: 'History',
        restore: 'Restore',
        empty: 'Nothing was recorded for this note.',
        placeholder: 'Pick a version to see what it changed.',
        degraded: 'History fell behind',
    },

    editor: {
        readOnly: 'This server is read-only. You can read the source here, but it cannot be saved.',
        draft: 'An unsaved draft was found',
        conflictMine: 'Your version',
        conflictTheirs: 'On disk',
    },

    login: {
        title: 'Sign in',
        // the server's form is the one login screen there is, and it titles
        // its message
        wrong: 'Wrong user name or password',
    },

    notFound: 'Nothing here',

    code: {
        copy: 'Copy',
        copied: 'Copied',
    },
};
