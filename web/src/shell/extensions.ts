import { createContext, useContext, type ComponentType, type RefObject } from 'react';

import type { DocumentResponse } from '../api/types';

// the glyph a row menu draws, which the inset of a tree row lines up with
export const rowMenuIconSize = 16;

export interface RowMenuProps {
  path: string;
  isDir: boolean;
  name: string;
  touch: boolean;
  // the row holds the state, because a right click or a long press anywhere
  // on it opens the menu too
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
}

export interface DocumentExtrasProps {
  doc: DocumentResponse;
  // true while the reading anchor is placing this arrival
  placed: RefObject<boolean>;
}

// ReaderExtensions are what an entry adds to the reader around a note and a
// tree row. The reader imports none of them, so a site carries only its own.
export interface ReaderExtensions {
  DocumentExtras?: ComponentType<DocumentExtrasProps>;
  RowMenu?: ComponentType<RowMenuProps>;
}

const none: ReaderExtensions = {};

const ExtensionsContext = createContext<ReaderExtensions>(none);

export const ReaderExtensionsProvider = ExtensionsContext.Provider;

export function useReaderExtensions(): ReaderExtensions {
  return useContext(ExtensionsContext);
}
