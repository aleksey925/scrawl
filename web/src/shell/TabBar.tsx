import { useState, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { Sheet, SheetTile, SheetTiles, useKeptFocus } from '../components/Sheet';
import { planMotion } from '../components/screenMotion';
import { IconFilePlus, IconFolder, IconFolderPlus, IconPlus, IconSearch } from '../icons';
import { reducedMotion } from '../motion';
import {
  directoryUrl, isDirectoryPath, isEditPath, isProfilePath, isRecentPath, profileUrl,
} from '../paths';
import { layout } from '../theme';

import { Avatar } from './Avatar';
import { Capsule, capsuleClasses } from './Capsule';
import { useFileActions } from './fileActionsContext';
import { basenameOf, folderFor } from './naming';
import { spaceLabel, useAccount, useTree } from './NavContext';
import { useSearchControl } from './searchOpener';
import { usePageBarClaimed } from './ShellSlots';
import classes from './TabBar.module.css';

type TabName = 'notes' | 'search' | 'profile';

interface TabProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  name: TabName;
  label: string;
  icon: ReactNode;
  current: boolean;
}

function Tab({ name, label, icon, current, ...rest }: TabProps): JSX.Element {
  return (
    <button
      {...rest}
      type="button"
      data-testid={`tab-${name}`}
      data-current={current ? 'true' : 'false'}
      aria-current={current ? 'page' : undefined}
      className={classes.tab}
    >
      {icon}
      <span className={classes.label}>{label}</span>
    </button>
  );
}

function NewButton({ here }: { here: string }): JSX.Element {
  const actions = useFileActions();
  const { me } = useAccount();
  const [opened, setOpened] = useState(false);
  const { returnFocus, keepFocus } = useKeptFocus(opened);
  const create = (make: (dir: string) => void): void => {
    if (!opened) {
      return;
    }
    keepFocus();
    setOpened(false);
    make(here);
  };

  return (
    <>
      <button
        type="button"
        data-testid="tab-new"
        aria-label="New"
        aria-haspopup="dialog"
        aria-expanded={opened}
        className={capsuleClasses.round}
        data-print="hide"
        onClick={() => setOpened(true)}
      >
        <IconPlus size={layout.iconSizeTile} aria-hidden />
      </button>
      <Sheet
        opened={opened}
        onClose={() => setOpened(false)}
        testId="new-menu"
        overlayTestId="new-scrim"
        returnFocus={returnFocus}
        title={
          <>
            Create in <span className={classes.folder}>{here === '' ? spaceLabel(me) : basenameOf(here)}</span>
          </>
        }
      >
        <SheetTiles>
          <SheetTile big testId="new-menu-folder" label="New folder" icon={IconFolderPlus} onClick={() => create(actions.newFolder)} />
          <SheetTile big testId="new-menu-note" label="New note" icon={IconFilePlus} onClick={() => create(actions.newNote)} />
        </SheetTiles>
      </Sheet>
    </>
  );
}

export function TabBar(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const search = useSearchControl();
  const { canWrite, me } = useAccount();
  const { currentPath } = useTree();
  const claimed = usePageBarClaimed();

  if (claimed || isEditPath(location.pathname)) {
    return null;
  }

  const searching = search?.opened ?? false;
  const here = folderFor(currentPath, currentPath === '' || isDirectoryPath(location.pathname));
  const atRecent = isRecentPath(location.pathname);
  const atProfile = isProfilePath(location.pathname);
  const atNotes = !searching && !atRecent && !atProfile;
  const go = (url: string, current: boolean): void => {
    if (current) {
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    search?.close();
    planMotion(url, 'none');
    void navigate(url);
  };
  const user = me?.user ?? '';

  return (
    <>
      <Capsule testId="tab-bar" label="Tabs" kind="tabs" withNew={canWrite}>
        <Tab
          name="notes"
          label="Notes"
          icon={<IconFolder size={layout.iconSizeLarge} weight={atNotes ? 'fill' : 'regular'} aria-hidden />}
          current={atNotes}
          onClick={() => go(directoryUrl(''), atNotes && location.pathname === directoryUrl(''))}
        />
        {search !== undefined && (
          <Tab
            name="search"
            label="Search"
            icon={<IconSearch size={layout.iconSizeLarge} weight={searching || atRecent ? 'fill' : 'regular'} aria-hidden />}
            current={searching || atRecent}
            onClick={() => search.open()}
          />
        )}
        <Tab
          name="profile"
          label="Profile"
          icon={<Avatar name={user} size={layout.iconSizeLarge} className={classes.avatar} />}
          current={atProfile && !searching}
          onClick={() => go(profileUrl(), atProfile && !searching)}
        />
      </Capsule>
      {canWrite && <NewButton here={here} />}
    </>
  );
}
