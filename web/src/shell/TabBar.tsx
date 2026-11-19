import { Menu } from '@mantine/core';
import { useRef, useState, type ComponentPropsWithRef, type JSX } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { PopupMenu } from '../components/PopupMenu';
import { planMotion } from '../components/screenMotion';
import {
  IconClock,
  IconFolder,
  IconPencil,
  IconPlus,
  IconSearch,
  IconUserCircle,
  type Icon,
} from '../icons';
import { reducedMotion } from '../motion';
import { isDirectoryPath, isEditPath, isRecentPath, recentUrl } from '../paths';
import { layout } from '../theme';

import { useBarEdit, type BarEdit } from './BarEditProvider';
import { useFileActions } from './fileActionsContext';
import { useAccount, useTree } from './NavContext';
import { folderFor } from './naming';
import { NewTiles } from './NewTiles';
import { useSearchControl } from './searchOpener';
import { SpaceMenuDropdown } from './SpaceMenu';
import classes from './TabBar.module.css';

type TabName = 'notes' | 'search' | 'recent' | 'new' | 'edit' | 'profile';

interface TabProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  name: TabName;
  label: string;
  icon: Icon;
  current: boolean;
}

function tabTestId(name: TabName): string {
  return `tab-${name}`;
}

function TabBody({ icon: TabIcon, label, current = false }: { icon: Icon; label: string; current?: boolean }): JSX.Element {
  return (
    <>
      <TabIcon size={layout.iconSizeLarge} weight={current ? 'fill' : 'regular'} />
      <span className={classes.label}>{label}</span>
    </>
  );
}

function Tab({ name, label, icon, current, ...rest }: TabProps): JSX.Element {
  return (
    <button
      {...rest}
      type="button"
      data-testid={tabTestId(name)}
      data-current={current ? 'true' : 'false'}
      aria-current={current ? 'page' : undefined}
      className={classes.tab}
    >
      <TabBody icon={icon} label={label} current={current} />
    </button>
  );
}

function EditCell({ edit }: { edit: BarEdit }): JSX.Element {
  const body = <TabBody icon={IconPencil} label="Edit" />;
  return edit.kind === 'edit' ? (
    <Link data-testid={tabTestId('edit')} to={edit.to} className={classes.tab}>
      {body}
    </Link>
  ) : (
    <a data-testid={tabTestId('edit')} role="link" aria-disabled="true" className={classes.tab}>
      {body}
    </a>
  );
}

function NewCell({ here }: { here: string }): JSX.Element {
  const actions = useFileActions();
  const [opened, setOpened] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    setOpened(false);
    button.current?.focus({ preventScroll: true });
  };
  const create = (make: (dir: string) => void): void => {
    setOpened(false);
    make(here);
  };

  return (
    <>
      <Tab
        ref={button}
        name="new"
        label="New"
        icon={IconPlus}
        current={false}
        aria-haspopup="menu"
        aria-expanded={opened}
        onClick={() => setOpened((was) => !was)}
      />
      <NewTiles
        opened={opened}
        onClose={close}
        onFolder={() => create(actions.newFolder)}
        onNote={() => create(actions.newNote)}
      />
    </>
  );
}

export function TabBar(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const search = useSearchControl();
  const { canWrite } = useAccount();
  const { currentPath } = useTree();
  const edit = useBarEdit();

  if (isEditPath(location.pathname)) {
    return null;
  }

  const searching = search?.opened ?? false;
  const here = folderFor(currentPath, currentPath === '' || isDirectoryPath(location.pathname));
  const atRecent = isRecentPath(location.pathname);
  const atNotes = !searching && !atRecent;
  const go = (url: string): void => {
    if (!searching && (isRecentPath(url) ? atRecent : location.pathname === url)) {
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    search?.close();
    planMotion(url, 'none');
    void navigate(url);
  };

  return (
    <nav data-testid="tab-bar" aria-label="Tabs" className={classes.bar} data-print="hide">
      <Tab name="notes" label="Notes" icon={IconFolder} current={atNotes} onClick={() => go('/')} />
      {search !== undefined && (
        <Tab name="search" label="Search" icon={IconSearch} current={searching} onClick={() => search.open()} />
      )}
      {canWrite && (edit === undefined ? <NewCell here={here} /> : <EditCell edit={edit} />)}
      <Tab name="recent" label="Recent" icon={IconClock} current={!searching && atRecent} onClick={() => go(recentUrl())} />
      <PopupMenu position="top-end" offset={4} width={layout.menuWidthWide} withinPortal>
        <Menu.Target>
          <Tab name="profile" label="Profile" icon={IconUserCircle} current={false} />
        </Menu.Target>
        <SpaceMenuDropdown />
      </PopupMenu>
    </nav>
  );
}
