import { Button, Drawer, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { useState, type FormEvent, type JSX } from 'react';

import type { EntryKind } from '../api/types';

import type { TreeDraft } from './fileActionsContext';

export interface NewSheetProps {
  draft: TreeDraft;
  onCreate: (draft: TreeDraft, name: string) => Promise<boolean>;
  onClose: () => void;
}

// NewSheet is where a phone makes a note or a folder, in the folder on screen:
// it has no tree to type the name into
export function NewSheet({ draft, onCreate, onClose }: NewSheetProps): JSX.Element {
  const [kind, setKind] = useState<EntryKind>(draft.kind);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim() === '') {
      return;
    }
    setBusy(true);
    void onCreate({ kind, parent: draft.parent }, name.trim()).then((created) => {
      setBusy(false);
      if (created) {
        onClose();
      }
    });
  }

  return (
    <Drawer
      data-testid="new-sheet"
      opened
      onClose={onClose}
      position="bottom"
      size="auto"
      title={kind === 'file' ? 'New note' : 'New folder'}
      radius="xl"
      styles={{
        inner: { bottom: 'var(--scrawl-tabbar-space)' },
        content: { flex: 'none', width: '100%', height: 'auto', paddingBottom: 'var(--scrawl-sheet-inset)' },
      }}
    >
      <form onSubmit={submit}>
        <Stack gap="md">
          <SegmentedControl
            data-testid="new-sheet-kind"
            fullWidth
            value={kind}
            onChange={(value) => setKind(value === 'dir' ? 'dir' : 'file')}
            data={[
              { value: 'file', label: 'Note' },
              { value: 'dir', label: 'Folder' },
            ]}
          />
          <TextInput
            data-testid="new-sheet-name"
            data-autofocus
            placeholder={kind === 'file' ? 'Name of the note' : 'Name of the folder'}
            value={name}
            autoComplete="off"
            onChange={(event) => setName(event.currentTarget.value)}
          />
          {draft.parent !== '' && (
            <Text size="sm" c="dimmed">
              In {draft.parent}
            </Text>
          )}
          <Button data-testid="new-sheet-create" type="submit" fullWidth size="md" loading={busy} disabled={name.trim() === ''}>
            Create
          </Button>
        </Stack>
      </form>
    </Drawer>
  );
}
