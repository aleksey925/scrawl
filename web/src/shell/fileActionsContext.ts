import { createContext, useContext } from 'react';

import type { EntryKind } from '../api/types';

// TreeDraft is a row that does not exist yet: the tree shows an input where the
// entry will be, and the name is typed in place. There is no dialog, because a
// dialog asks for the one thing the tree already knows - which folder - and
// then covers the answer while the name is typed.
export interface TreeDraft {
  kind: EntryKind;
  parent: string;
}

// FileActions are the writes the app offers on the tree and on a folder. A
// reader with none of them, a site, shows the same tree with nothing to write.
export interface FileActions {
  createPage: (folder: string) => void;
  createFolder: (folder: string) => void;
  rename: (path: string, isDir: boolean) => void;
  remove: (path: string, isDir: boolean) => void;
  copyLink: (path: string, isDir: boolean) => void;
  // moveInto is the drop half of dragging rows around the tree. It takes the
  // whole selection, because dragging one of several selected rows moves them
  // all, which is what every file manager does.
  moveInto: (paths: readonly string[], folder: string) => void;
  draft: TreeDraft | undefined;
  // true when the entry was created, so the row can keep the typed name on
  // screen for a second try when it was not
  submitDraft: (name: string) => Promise<boolean>;
  cancelDraft: () => void;
}

export const FileActionsContext = createContext<FileActions | undefined>(undefined);

export function useFileActions(): FileActions {
  const actions = useContext(FileActionsContext);
  if (actions === undefined) {
    throw new Error('file actions are only available inside the app shell');
  }
  return actions;
}

// useOptionalFileActions is the actions where the reader is one that writes
export function useOptionalFileActions(): FileActions | undefined {
  return useContext(FileActionsContext);
}
