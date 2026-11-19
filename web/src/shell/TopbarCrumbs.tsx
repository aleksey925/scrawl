import { Popover, UnstyledButton } from '@mantine/core';
import { useEffect, useState, type JSX } from 'react';
import { Link, useLocation } from 'react-router';

import { EntryIcon } from '../components/EntryIcon';
import { RenameField } from '../components/RenameField';
import { TapGuard } from '../components/TapGuard';
import controls from '../controls.module.css';
import { IconFolder } from '../icons';
import { isDirectoryPath } from '../paths';
import { layout } from '../theme';

import { DraftNameField } from './DraftName';
import { usePageRenaming } from './fileActionsContext';
import { spaceLabel, useAccount } from './NavContext';
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
  const { me } = useAccount();
  const chrome = useShownChrome();
  const space = spaceLabel(me);
  const atSpace = chrome.name === '';
  const location = useLocation();
  const current = contentPathOf(location.pathname);
  const isDir = isDirectoryPath(location.pathname);
  const { renaming, commit } = usePageRenaming();
  const draft = chrome.draft;
  const [naming, setNaming] = useState(false);
  const editing = renaming !== undefined || (naming && draft !== undefined);
  useEffect(() => setNaming(false), [location.pathname]);
  const icon = (
    <EntryIcon name={draft?.path ?? current} isDir={isDir} size={layout.iconSizeSmall} className={classes.crumbIcon} />
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
            opened={editing}
            position="bottom-start"
            offset={renameOffset}
            width={layout.popoverWidth}
            floatingStrategy="fixed"
            trapFocus={false}
            returnFocus={false}
            closeOnClickOutside={false}
            closeOnEscape={false}
            transitionProps={{ duration: 0 }}
            withRoles={false}
            radius="lg"
            shadow="md"
            classNames={{ dropdown: controls.menu }}
          >
            <Popover.Target>
              {draft === undefined ? (
                <span data-testid="crumb" data-current="true" className={`${classes.crumb} ${classes.current}`}>
                  {icon}
                  <span className={classes.crumbText}>{chrome.name}</span>
                </span>
              ) : (
                <UnstyledButton
                  data-testid="crumb"
                  data-current="true"
                  data-draft="true"
                  className={`${classes.crumb} ${classes.draft}`}
                  aria-label={`Name the new note, now ${chrome.name}`}
                  onClick={() => setNaming(true)}
                >
                  {icon}
                  <span className={classes.crumbText}>{chrome.name}</span>
                </UnstyledButton>
              )}
            </Popover.Target>
            <Popover.Dropdown data-testid={renaming === undefined ? 'draft-name' : 'page-rename'} p={0}>
              {renaming !== undefined && (
                <RenameField session={renaming} testId="page-rename" icon={icon} className={classes.field} />
              )}
              {renaming === undefined && naming && draft !== undefined && (
                <DraftNameField draft={draft} icon={icon} className={classes.field} onDone={() => setNaming(false)} />
              )}
            </Popover.Dropdown>
          </Popover>
          <TapGuard active={editing} onClose={renaming !== undefined ? commit : () => setNaming(false)} />
        </span>
      )}
    </nav>
  );
}
