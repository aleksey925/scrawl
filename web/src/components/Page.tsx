import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import classes from './Page.module.css';

export interface PageProps extends ComponentPropsWithoutRef<'div'> {
  // wide runs the room beside the sidebar whatever the page width setting,
  // for a table with no line of text to keep short
  wide?: boolean;
  children: ReactNode;
}

// Page is the one surface every screen is drawn on: a note, a folder, a file,
// a search, a note that does not exist and a page that broke
export function Page({ wide = false, className, children, ...rest }: PageProps): JSX.Element {
  return (
    <div {...rest} className={className === undefined ? classes.page : `${classes.page} ${className}`} data-variant={wide ? 'wide' : 'note'}>
      {children}
    </div>
  );
}

export interface PageTitleProps {
  children: ReactNode;
  // faint is a title for something that is not there yet
  faint?: boolean;
  testId?: string;
}

// PageTitle is the title of a page that has no heading of its own to show as
// one: a folder, a file, a note that does not exist yet
export function PageTitle({ children, faint = false, testId }: PageTitleProps): JSX.Element {
  return (
    <h1 data-testid={testId} className={faint ? `${classes.title} ${classes.faint}` : classes.title}>
      {children}
    </h1>
  );
}
