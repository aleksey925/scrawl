import { ActionIcon, Menu } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { EmptyState } from '../components/EmptyState';
import { Page, PageTitle } from '../components/Page';
import { PopupMenu } from '../components/PopupMenu';
import { IconClock, IconDots, IconFileText, IconTrash } from '../icons';
import { documentUrl } from '../paths';
import { usePageChrome } from '../shell/PageChrome';
import { useRecentNotes } from '../shell/recentNotes';
import { PageActions } from '../shell/ShellSlots';
import { layout } from '../theme';

import classes from './RecentPage.module.css';

// the notes opened last on this device, newest first: the phone's Recent tab
export function Component(): JSX.Element {
  const { notes, clear } = useRecentNotes();
  usePageChrome({ crumbs: [], title: 'Recent', ownTitle: true });

  return (
    <Page data-testid="recent">
      <PageActions>
        <PopupMenu position="bottom-end" width={layout.menuWidth} withinPortal>
          <Menu.Target>
            <ActionIcon data-testid="recent-menu" variant="subtle" color="gray" size="lg" aria-label="More actions">
              <IconDots size={layout.iconSize} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              data-testid="recent-menu-clear"
              leftSection={<IconTrash size={layout.iconSizeSmall} />}
              disabled={notes.length === 0}
              onClick={clear}
            >
              Clear the list
            </Menu.Item>
          </Menu.Dropdown>
        </PopupMenu>
      </PageActions>

      <PageTitle testId="recent-title">Recent</PageTitle>
      {notes.length === 0 ? (
        <EmptyState testId="recent-empty" icon={IconClock} title="Nothing opened yet">
          The notes you open on this device are listed here.
        </EmptyState>
      ) : (
        <div className={classes.list}>
          {notes.map((recent) => (
            <Link key={recent.path} data-testid="recent-item" data-path={recent.path} to={documentUrl(recent.path)} className={classes.row}>
              <IconFileText size={layout.iconSize} aria-hidden className={classes.icon} />
              <span className={classes.text}>
                <span className={classes.title}>{recent.title === '' ? recent.path : recent.title}</span>
                <span className={classes.path}>{recent.path}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
