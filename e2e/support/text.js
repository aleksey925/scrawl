module.exports = {
    status: {
        saved: 'Saved',
        dirty: 'Unsaved changes',
        new: 'New note',
        saving: 'Saving',
        uploading: 'Waiting for the upload',
    },

    modal: {
        leave: 'Leave without saving?',
        conflict: 'This file changed on disk',
        restore: 'Restore this version?',
        restoreConflict: 'This page changed while the history was open',
        session: 'Your session expired',
    },

    toast: {
        saved: 'Saved',
        restored: 'Restored',
        folderCreated: 'Created folder',
        moved: 'Moved',
        movedMany: 'Moved 2 items',
        renamed: 'Renamed',
        notNoteNow: 'It is not a note now, so the tree does not show it',
        deleted: 'Deleted',
        notDeleted: 'Nothing was deleted',
        notMovedBack: 'Nothing was moved back',
        partlyMovedBack: 'Some of it did not move back',
        changedSince: 'It was renamed, moved or deleted since',
        imageUploaded: 'Image uploaded',
        linkCopied: 'Copied the link',
        noHeadings: 'No headings to list',
        contentsFailed: 'Could not build the contents',
    },

    pageExists: 'That file already exists',
    folderExists: 'That folder already exists',
    renameSlash: 'A name cannot hold a slash, use Move to instead',
    renameDot: 'A name cannot start with a dot',
    renameFailed: 'Nothing was renamed',
    nameTaken: 'Something of that name is already there',

    doc: {
        missing: 'This note does not exist yet.',
        create: 'Create it',
        edit: 'Edit',
        history: 'History',
        empty: 'This note is empty',
    },

    dir: {
        empty: 'This folder is empty',
    },

    search: {
        empty: 'No notes match that.',
        prompt: 'Type a query to search every note.',
        results: 'results',
        regexHint: 'Regular expression over the text as shown, line by line',
    },

    sidebar: {
        newPage: 'New file',
        newFolder: 'New folder',
        nothingMatches: 'Nothing matches. Press Enter to search the text of every note.',
    },

    history: {
        title: 'Versions',
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
        changesTooLarge: 'This document is too large to compare. Editing and saving still work.',
        changesFailed: 'Could not compare',
    },

    login: {
        title: 'Sign in',
        wrong: 'Wrong user name or password',
    },

    notFound: 'Nothing here',

    code: {
        copy: 'Copy',
        copied: 'Copied',
    },
};
