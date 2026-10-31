module.exports = {
    status: {
        saved: 'Saved',
        dirty: 'Unsaved changes',
        new: 'New note',
        saving: 'Saving',
        uploading: 'Waiting for the upload',
    },

    modal: {
        rename: 'Rename or move',
        deleteFile: 'Delete file?',
        deleteFolder: 'Delete folder?',
        deleteFolderContents: 'Delete folder and everything in it?',
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
        moved: 'Moved',
        movedMany: 'Moved 2 items',
        renamed: 'Renamed',
        deleted: 'Deleted',
        notDeleted: 'Nothing was deleted',
        imageUploaded: 'Image uploaded',
        linkCopied: 'Link copied',
    },

    pageExists: 'That file already exists',
    folderExists: 'That folder already exists',

    doc: {
        missing: 'This note does not exist yet.',
        create: 'Create it',
        edit: 'Edit',
        history: 'History',
        empty: 'This note is empty',
    },

    dir: {
        empty: 'This folder is empty',
        noNotes: 'No notes inside',
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
