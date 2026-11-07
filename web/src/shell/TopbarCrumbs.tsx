import { Popover } from '@mantine/core';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

import { EntryIcon } from '../components/EntryIcon';
import { RenameField } from '../components/RenameField';
import { TapGuard } from '../components/TapGuard';
import controls from '../controls.module.css';
import { IconFolder } from '../icons';
import { isDirectoryPath } from '../paths';
import { layout } from '../theme';

import { useOptionalFileActions, useRenamingHere } from './fileActionsContext';
import { spaceLabel, useNav } from './NavContext';
import { contentPathOf } from './naming';
import { useShownChrome } from './PageChrome';
import classes from './Topbar.module.css';

const renameOffset = 6;

function Separator(): JSX.Element {
  return (
    <span className={classes.separator} aria-hidden>
      /
    </span>
  );
}

export function TopbarCrumbs(): JSX.Element {
  const { me } = useNav();
  const chrome = useShownChrome();
  const space = spaceLabel(me);
  const atSpace = chrome.title === '';
  const location = useLocation();
  const current = contentPathOf(location.pathname);
  const isDir = isDirectoryPath(location.pathname);
  const commitRename = useOptionalFileActions()?.commitRename;
  const renaming = useRenamingHere('page', current);
  const icon = (
    <EntryIcon name={current} isDir={isDir} size={layout.iconSizeSmall} className={classes.crumbIcon} />
  );

  return (
    <nav data-testid="topbar-crumbs" aria-label="Path" className={classes.crumbs}>
      {atSpace ? (
        <span data-testid="crumb" data-current="true" className={`${classes.crumb} ${classes.current}`}>
          <span className={classes.crumbText}>{space}</span>
        </span>
      ) : (
        <Link data-testid="crumb" data-current="false" to="/" className={classes.crumb}>
          <span className={classes.crumbText}>{space}</span>
        </Link>
      )}
      {chrome.crumbs.map((link) => (
        <span key={link.url} className={classes.step}>
          <Separator />
          <Link data-testid="crumb" data-current="false" to={link.url} className={classes.crumb}>
            <IconFolder size={layout.iconSizeSmall} className={classes.crumbIcon} />
            <span className={classes.crumbText}>{link.name}</span>
          </Link>
        </span>
      ))}
      {!atSpace && (
        <span className={`${classes.step} ${classes.last}`}>
          <Separator />
          <Popover
            opened={renaming !== undefined}
            position="bottom-start"
            offset={renameOffset}
            width={layout.popoverWidth}
            floatingStrategy="fixed"
            trapFocus={false}
            returnFocus={false}
            closeOnClickOutside={false}
            closeOnEscape={false}
            withRoles={false}
            radius="lg"
            shadow="md"
            classNames={{ dropdown: controls.menu }}
          >
            <Popover.Target>
              <span data-testid="crumb" data-current="true" className={`${classes.crumb} ${classes.current}`}>
                {icon}
                <span className={classes.crumbText}>{chrome.name}</span>
              </span>
            </Popover.Target>
            <Popover.Dropdown data-testid="page-rename" p={0}>
              {renaming !== undefined && (
                <RenameField session={renaming} testId="page-rename" icon={icon} className={classes.rename} />
              )}
            </Popover.Dropdown>
          </Popover>
          {commitRename !== undefined && <TapGuard active={renaming !== undefined} onClose={commitRename} />}
        </span>
      )}
    </nav>
  );
}
