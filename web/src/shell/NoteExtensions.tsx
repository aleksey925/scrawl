import { useMemo, type JSX, type ReactNode } from 'react';

import { DocumentExtras } from './DocumentExtras';
import { ReaderExtensionsProvider, useReaderExtensions } from './extensions';
import { FileView } from './FileView';

export function NoteExtensions({ children }: { children: ReactNode }): JSX.Element {
  const outer = useReaderExtensions();
  const value = useMemo(() => ({ ...outer, DocumentExtras, FileView }), [outer]);
  return <ReaderExtensionsProvider value={value}>{children}</ReaderExtensionsProvider>;
}
