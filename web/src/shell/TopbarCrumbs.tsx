import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

import { EntryIcon } from '../components/EntryIcon';
import { IconFolder } from '../icons';
import { isDirectoryPath } from '../paths';
import { layout } from '../theme';

import { spaceLabel, useNav } from './NavContext';
import { contentPathOf } from './naming';
import { useShownChrome } from './PageChrome';
import { SpaceTile } from './SpaceTile';
import classes from './Topbar.module.css';

function Separator(): JSX.Element {
  return (
    <span className={classes.separator} aria-hidden>
      /
    </span>
  );
}

// TopbarCrumbs is the path of the page on screen: the space first, the folders
// on the way, and the page's own title last.
export function TopbarCrumbs(): JSX.Element {
  const { me } = useNav();
  const chrome = useShownChrome();
  const space = spaceLabel(me);
  const atSpace = chrome.title === '';
  const location = useLocation();
  const current = contentPathOf(location.pathname);

  return (
    <nav data-testid="topbar-crumbs" aria-label="Path" className={classes.crumbs}>
      {atSpace ? (
        <span data-testid="crumb" data-current="true" className={`${classes.crumb} ${classes.current}`}>
          <SpaceTile name={space} small />
          <span className={classes.crumbText}>{space}</span>
        </span>
      ) : (
        <Link data-testid="crumb" data-current="false" to="/" className={classes.crumb}>
          <SpaceTile name={space} small />
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
          <span data-testid="crumb" data-current="true" className={`${classes.crumb} ${classes.current}`}>
            <EntryIcon
              name={current}
              isDir={isDirectoryPath(location.pathname)}
              size={layout.iconSizeSmall}
              className={classes.crumbIcon}
            />
            <span className={classes.crumbText}>{chrome.title}</span>
          </span>
        </span>
      )}
    </nav>
  );
}
