import { createContext, useContext, type ComponentType, type RefObject } from 'react';

import type { DocumentResponse, FilePageResponse } from '../api/types';
import type { Point } from '../components/pointerMenu';
import { layout } from '../theme';

export const rowMenuIconSize = layout.iconSizeSmall;

export interface RowMenuProps {
  path: string;
  isDir: boolean;
  name: string;
  touch: boolean;
  inTree?: boolean;
  editUrl?: string;
  runPath?: string;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  at?: Point;
}

export interface RunLinkProps {
  path: string;
  className: string | undefined;
}

export interface DocumentExtrasProps {
  doc: DocumentResponse;
  placed: RefObject<boolean>;
}

export interface ReaderExtensions {
  DocumentExtras?: ComponentType<DocumentExtrasProps>;
  RowMenu?: ComponentType<RowMenuProps>;
  FileView?: ComponentType<{ file: FilePageResponse }>;
  RunLink?: ComponentType<RunLinkProps>;
}

const none: ReaderExtensions = {};

const ExtensionsContext = createContext<ReaderExtensions>(none);

export const ReaderExtensionsProvider = ExtensionsContext.Provider;

export function useReaderExtensions(): ReaderExtensions {
  return useContext(ExtensionsContext);
}
