import { Button, Container, Stack, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useEffect, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router';

import { api } from '../api/client';
import { errorText, useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { documentUrl } from '../paths';
import { PageActions } from '../shell/ShellSlots';
import { layout } from '../theme';

export function Component(): JSX.Element {
  const params = useParams();
  const path = decodeURIComponent(params['*'] ?? '');

  const state = useApi((signal) => api.file(path, { signal }), [path]);
  const [content, setContent] = useState('');
  const [rev, setRev] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state.data !== undefined) {
      setContent(state.data.content);
      setRev(state.data.rev);
    }
  }, [state.data]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const saved = await api.saveFile(path, { content, rev });
      setRev(saved.rev);
      notifications.show({ message: 'Saved', color: 'green' });
    } catch (error: unknown) {
      notifications.show({ message: errorText(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Container size={layout.contentMeasure} px={0}>
      <AsyncContent state={state}>
        {(file) => (
          <>
            <PageActions>
              <Button
                size="xs"
                loading={saving}
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={() => void save()}
              >
                Save
              </Button>
              <Button component={Link} to={documentUrl(path)} variant="subtle" color="gray" size="xs">
                Cancel
              </Button>
            </PageActions>

            <Stack gap="lg">
              <Title order={1}>{file.path}</Title>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.currentTarget.value)}
                autosize
                minRows={20}
                spellCheck={false}
                aria-label="Document source"
                styles={{
                  input: {
                    fontFamily: 'var(--mantine-font-family-monospace)',
                    fontSize: `${layout.inputFontSize}px`,
                  },
                }}
              />
            </Stack>
          </>
        )}
      </AsyncContent>
    </Container>
  );
}
