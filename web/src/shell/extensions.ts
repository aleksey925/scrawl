import { createContext, useContext, type ComponentType, type ReactElement, type RefObject } from 'react';

import type { DocumentResponse, FilePageResponse } from '../api/types';
import { layout } from '../theme';

export const rowMenuIconSize = layout.iconSizeSmall;

export interface RowMenuProps {
  path: string;
  isDir: boolean;
  name: string;
  touch: boolean;
  editUrl?: string;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  target?: ReactElement;
}

export interface DocumentExtrasProps {
  doc: DocumentResponse;
  placed: RefObject<boolean>;
}

export interface ReaderExtensions {
  DocumentExtras?: ComponentType<DocumentExtrasProps>;
  RowMenu?: ComponentType<RowMenuProps>;
  FileView?: ComponentType<{ file: FilePageResponse }>;
}

const none: ReaderExtensions = {};

const ExtensionsContext = createContext<ReaderExtensions>(none);

export const ReaderExtensionsProvider = ExtensionsContext.Provider;

export function useReaderExtensions(): ReaderExtensions {
  return useContext(ExtensionsContext);
}
