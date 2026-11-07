import { Button, Modal, Text, TextInput } from '@mantine/core';
import { useState, type FormEvent, type JSX } from 'react';

import { DialogActions } from '../components/DialogActions';

import { basenameOf, pageName } from './naming';

export interface RenameDialogProps {
  path: string;
  onRename: (name: string) => Promise<boolean>;
  onClose: () => void;
}

export function RenameDialog({ path, onRename, onClose }: RenameDialogProps): JSX.Element {
  const [name, setName] = useState(() => pageName(basenameOf(path), false));
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim() === '' || busy) {
      return;
    }
    setBusy(true);
    void onRename(name).then((renamed) => {
      setBusy(false);
      if (renamed) {
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
      withCloseButton={false}
      title="Rename"
      data-testid="rename"
    >
      <form onSubmit={submit}>
        <TextInput
          data-testid="rename-name"
          data-autofocus
          size="md"
          aria-label={`New name of ${basenameOf(path)}`}
          value={name}
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Text size="sm" c="dimmed" mt={6}>
          Links in other notes are not rewritten
        </Text>
        <DialogActions mt="md">
          <Button data-testid="rename-cancel" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="rename-submit" type="submit" loading={busy} disabled={name.trim() === ''}>
            Rename
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}
