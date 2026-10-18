import { createContext, useContext, type ComponentType, type RefObject } from 'react';

import type { DocumentResponse } from '../api/types';

// the glyph a row menu draws, which the inset of a tree row lines up with
export const rowMenuIconSize = 16;

export interface RowMenuProps {
  path: string;
  isDir: boolean;
  name: string;
  touch: boolean;
}

export interface DocumentExtrasProps {
  doc: DocumentResponse;
  // true while the reading anchor is placing this arrival
  placed: RefObject<boolean>;
}

// ReaderExtensions are what the app adds to the reader around a note and a
// tree row. The reader imports none of them, so a site carries none of them.
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
