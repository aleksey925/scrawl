import { Menu } from '@mantine/core';
import type { ComponentPropsWithRef, JSX } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { PopupMenu } from '../components/PopupMenu';
import { planMotion } from '../components/screenMotion';
import { IconClock, IconFilePlus, IconFolder, IconFolderPlus, IconPlus, IconSearch, type Icon } from '../icons';
import { isDirectoryPath, recentUrl } from '../paths';
import { layout } from '../theme';

import { useFileActions } from './fileActionsContext';
import { useNav } from './NavContext';
import { folderFor } from './naming';
import { useSearchControl } from './searchOpener';
import classes from './TabBar.module.css';
import { useBarsHidden } from './useBarsHidden';

const tabBarIconSize = 22;

type TabName = 'notes' | 'search' | 'recent' | 'new';

// the rest is what a mantine Menu.Target hands its button: a ref, the click
// that opens it and the aria state of the menu
interface TabProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  name: TabName;
  label: string;
  icon: Icon;
  current: boolean;
}

function Tab({ name, label, icon: TabIcon, current, ...rest }: TabProps): JSX.Element {
  return (
    <button
      {...rest}
      type="button"
      data-testid={`tab-${name}`}
      data-current={current ? 'true' : 'false'}
      aria-current={current ? 'page' : undefined}
      className={classes.tab}
    >
      <TabIcon size={tabBarIconSize} />
      <span className={classes.label}>{label}</span>
    </button>
  );
}

// TabBar is what a phone has instead of a sidebar, under the thumb: the notes
// of the space folder by folder, the search, the notes opened last, and a new
// note or folder where the reader is, picked in a menu over the tab. The
// editor is left out, it needs the screen for the text and the keyboard.
export function TabBar(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const search = useSearchControl();
  const actions = useFileActions();
  const { canWrite, currentPath } = useNav();
  useBarsHidden();

  if (location.pathname.startsWith('/edit/')) {
    return null;
  }

  const searching = search?.opened ?? false;
  const here = folderFor(currentPath, currentPath === '' || isDirectoryPath(location.pathname));
  const atRecent = location.pathname === recentUrl();
  const atNotes = !searching && !atRecent;
  const go = (url: string): void => {
    search?.close();
    planMotion(url, 'none');
    void navigate(url);
  };

  return (
    <nav data-testid="tab-bar" aria-label="Tabs" className={classes.bar} data-print="hide">
      <Tab name="notes" label="Notes" icon={IconFolder} current={atNotes} onClick={() => go('/')} />
      {search !== undefined && (
        <Tab name="search" label="Search" icon={IconSearch} current={searching} onClick={search.open} />
      )}
      <Tab name="recent" label="Recent" icon={IconClock} current={!searching && atRecent} onClick={() => go(recentUrl())} />
      {canWrite && (
        <PopupMenu position="top-end" offset={4} width={220} withinPortal>
          <Menu.Target>
            <Tab name="new" label="New" icon={IconPlus} current={false} />
          </Menu.Target>
          <Menu.Dropdown data-testid="new-menu">
            <Menu.Item
              data-testid="new-menu-note"
              leftSection={<IconFilePlus size={layout.iconSizeSmall} />}
              onClick={() => actions.createPage(here)}
            >
              New file
            </Menu.Item>
            <Menu.Item
              data-testid="new-menu-folder"
              leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
              onClick={() => actions.createFolder(here)}
            >
              New folder
            </Menu.Item>
          </Menu.Dropdown>
        </PopupMenu>
      )}
    </nav>
  );
}
