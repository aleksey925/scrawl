import type { JSX } from 'react';
import { Link } from 'react-router';

import { useNav } from './NavContext';
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
  const space = me?.space.label ?? me?.site_title ?? 'Notes';
  const atSpace = chrome.title === '';

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
      {chrome.crumbs.map((crumb) => (
        <span key={crumb.url} className={classes.step}>
          <Separator />
          <Link data-testid="crumb" data-current="false" to={crumb.url} className={classes.crumb}>
            <span className={classes.crumbText}>{crumb.name}</span>
          </Link>
        </span>
      ))}
      {!atSpace && (
        <span className={`${classes.step} ${classes.last}`}>
          <Separator />
          <span data-testid="crumb" data-current="true" className={`${classes.crumb} ${classes.current}`}>
            <span className={classes.crumbText}>{chrome.title}</span>
          </span>
        </span>
      )}
    </nav>
  );
}
