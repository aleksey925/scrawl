import { Button, Group, Modal, Text, TextInput } from '@mantine/core';
import { useState, type FormEvent, type JSX } from 'react';

import type { TreeDraft } from './fileActionsContext';

export interface NewEntryDialogProps {
  draft: TreeDraft;
  onCreate: (draft: TreeDraft, name: string) => Promise<boolean>;
  onClose: () => void;
}

// NewEntryDialog asks a phone for the name of a new note or folder, the way a
// phone asks for one: a small dialog in the middle with the field and two
// buttons side by side. A phone has no tree to type the name into.
export function NewEntryDialog({ draft, onCreate, onClose }: NewEntryDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const page = draft.kind === 'file';

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim() === '' || busy) {
      return;
    }
    setBusy(true);
    void onCreate(draft, name.trim()).then((created) => {
      setBusy(false);
      if (created) {
        onClose();
      }
    });
  }

  return (
    <Modal
      opened
      onClose={onClose}
      centered
      size={320}
      radius="lg"
      withCloseButton={false}
      title={page ? 'New note' : 'New folder'}
      data-testid="new-entry"
    >
      <form onSubmit={submit}>
        <TextInput
          data-testid="new-entry-name"
          data-autofocus
          size="md"
          placeholder={page ? 'Name of the note' : 'Name of the folder'}
          aria-label={page ? 'Name of the new note' : 'Name of the new folder'}
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.currentTarget.value)}
        />
        {draft.parent !== '' && (
          <Text size="sm" c="dimmed" mt={6}>
            In {draft.parent}
          </Text>
        )}
        <Group grow gap="xs" mt="md">
          <Button data-testid="new-entry-cancel" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="new-entry-create" type="submit" loading={busy} disabled={name.trim() === ''}>
            Create
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
