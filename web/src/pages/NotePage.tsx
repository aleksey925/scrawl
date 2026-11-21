import type { JSX } from 'react';

import { NoteExtensions } from '../shell/NoteExtensions';

import { Component as DocumentPage } from './DocumentPage';

export function Component(): JSX.Element {
  return (
    <NoteExtensions>
      <DocumentPage />
    </NoteExtensions>
  );
}
