import { Anchor, Text } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { Page, PageTitle } from '../components/Page';
import { usePageChrome } from '../shell/PageChrome';

export function Component(): JSX.Element {
  usePageChrome({ crumbs: [], title: 'Nothing here', ownTitle: true });
  return (
    <Page data-testid="app-notfound">
      <PageTitle>Nothing here</PageTitle>
      <Text c="dimmed" mb="md">
        That address does not match a note or a folder.
      </Text>
      <Anchor component={Link} to="/">
        Back to all notes
      </Anchor>
    </Page>
  );
}
