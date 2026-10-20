import type { JSX } from 'react';

import classes from './MiniOutline.module.css';
import { ReaderToc } from './ReaderToc';
import type { Outline } from './useOutline';

// MiniOutline is the outline on a wide screen: a column of short dashes at the
// right edge that opens into the list under the pointer or the focus. A line
// beside the text read as a second column of text.
export function MiniOutline({ outline }: { outline: Outline }): JSX.Element {
  // the two shallowest levels in use are the long dashes, deeper ones short
  const levels = [...new Set(outline.entries.map((entry) => entry.level))].sort((a, b) => a - b);
  const deepFrom = levels[2] ?? Number.POSITIVE_INFINITY;

  return (
    // focusable, so a tap and the keyboard open it the way the pointer does
    <nav data-testid="mini-outline" className={classes.outline} aria-label="On this page" tabIndex={0} data-print="hide">
      <div className={classes.lines} aria-hidden>
        {outline.entries.map((entry) => (
          <i
            key={entry.id}
            className={classes.dash}
            data-deep={entry.level >= deepFrom ? 'true' : 'false'}
            data-active={entry.id === outline.activeId ? 'true' : 'false'}
          />
        ))}
      </div>
      <div data-testid="mini-outline-panel" className={classes.panel}>
        <ReaderToc outline={outline} />
      </div>
    </nav>
  );
}
