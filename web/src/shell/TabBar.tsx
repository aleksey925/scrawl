import { IconClock, IconFolder, IconPlus, IconSearch, type Icon } from '../icons';
import type { JSX } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { isDirectoryPath, recentUrl } from '../paths';

import { useFileActions } from './fileActionsContext';
import { useNav } from './NavContext';
import { folderFor } from './naming';
import { useSearchControl } from './searchOpener';
import classes from './TabBar.module.css';
import { useBarsHidden } from './useBarsHidden';

const tabBarIconSize = 22;

type TabName = 'notes' | 'search' | 'recent' | 'new';

interface TabProps {
  name: TabName;
  label: string;
  icon: Icon;
  current: boolean;
  onClick: () => void;
}

function Tab({ name, label, icon: TabIcon, current, onClick }: TabProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={`tab-${name}`}
      data-current={current ? 'true' : 'false'}
      aria-current={current ? 'page' : undefined}
      className={classes.tab}
      onClick={onClick}
    >
      <TabIcon size={tabBarIconSize} />
      <span className={classes.label}>{label}</span>
    </button>
  );
}

// TabBar is what a phone has instead of a sidebar, under the thumb: the notes
// of the space folder by folder, the search, the notes opened last, and a new
// note or folder where the reader is. A tap closes the search first.
// The editor is left out, it needs the screen for the text and the keyboard.
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
  const atRecent = location.pathname === recentUrl();
  const atNotes = !searching && !atRecent;
  const go = (url: string): void => {
    search?.close();
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
        <Tab
          name="new"
          label="New"
          icon={IconPlus}
          current={false}
          onClick={() => {
            search?.close();
            actions.createPage(folderFor(currentPath, currentPath === '' || isDirectoryPath(location.pathname)));
          }}
        />
      )}
    </nav>
  );
}
