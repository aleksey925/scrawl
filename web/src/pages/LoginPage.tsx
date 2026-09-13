import { Alert, Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { api } from '../api/client';
import { errorText } from '../api/useApi';
import { layout } from '../theme';

export function Component(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (value) => (value.trim() === '' ? 'Enter your user name' : null),
      password: (value) => (value === '' ? 'Enter your password' : null),
    },
  });

  async function submit(values: { username: string; password: string }): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.login(values);
      await navigate(searchParams.get('from') ?? '/', { replace: true });
    } catch (failure: unknown) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const inputStyles = { input: { fontSize: `${layout.inputFontSize}px` } };

  return (
    <Center mih="100dvh" p="lg">
      <Paper withBorder shadow="md" p="xl" radius="lg" w={360}>
        <form onSubmit={form.onSubmit((values) => void submit(values))}>
          <Stack gap="lg">
            <Title order={2}>Sign in</Title>
            {error !== undefined && <Alert color="red">{error}</Alert>}
            <TextInput
              label="User name"
              autoComplete="username"
              styles={inputStyles}
              {...form.getInputProps('username')}
            />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              styles={inputStyles}
              {...form.getInputProps('password')}
            />
            <Button type="submit" loading={busy} h={layout.tapTarget}>
              Sign in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
