import { createContext, useContext } from 'react';

import type { EntryKind } from '../api/types';

export interface TreeDraft {
  kind: EntryKind;
  parent: string;
}

export interface FileActions {
  createPage: (folder: string) => void;
  createFolder: (folder: string) => void;
  rename: (path: string) => void;
  remove: (path: string, isDir: boolean) => void;
  copyLink: (path: string, isDir: boolean) => void;
  moveInto: (paths: readonly string[], folder: string) => void;
  draft: TreeDraft | undefined;
  submitDraft: (name: string) => Promise<boolean>;
  cancelDraft: () => void;
  createEntry: (draft: TreeDraft, name: string) => Promise<boolean>;
}

export const FileActionsContext = createContext<FileActions | undefined>(undefined);

export function useFileActions(): FileActions {
  const actions = useContext(FileActionsContext);
  if (actions === undefined) {
    throw new Error('file actions are only available inside the app shell');
  }
  return actions;
}

export function useOptionalFileActions(): FileActions | undefined {
  return useContext(FileActionsContext);
}
