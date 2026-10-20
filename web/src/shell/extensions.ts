import { createContext, useContext, type ComponentType, type ReactElement, type RefObject } from 'react';

import type { DocumentResponse, FilePageResponse } from '../api/types';
import { layout } from '../theme';

// the glyph a row menu draws, which the inset of a tree row lines up with
export const rowMenuIconSize = layout.iconSizeSmall;

export interface RowMenuProps {
  path: string;
  isDir: boolean;
  name: string;
  touch: boolean;
  // where the entry is edited; the menu offers no Edit without one
  editUrl?: string;
  // the row holds the state, because a right click or a long press anywhere
  // on it opens the menu too
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  // target is what the menu opens from in place of the row's own button: a
  // row lifted by a long press opens it from its own right edge
  target?: ReactElement;
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
  // the page of a file that is not a note, which only the app has
  FileView?: ComponentType<{ file: FilePageResponse }>;
}

const none: ReaderExtensions = {};

const ExtensionsContext = createContext<ReaderExtensions>(none);

export const ReaderExtensionsProvider = ExtensionsContext.Provider;

export function useReaderExtensions(): ReaderExtensions {
  return useContext(ExtensionsContext);
}
