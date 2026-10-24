import type { JSX } from 'react';

import classes from './MiniOutline.module.css';
import { ReaderToc } from './ReaderToc';
import type { Outline } from './useOutline';

export function MiniOutline({ outline }: { outline: Outline }): JSX.Element {
  const levels = [...new Set(outline.entries.map((heading) => heading.level))].sort((a, b) => a - b);
  const deepFrom = levels[2] ?? Number.POSITIVE_INFINITY;

  return (
    <nav data-testid="mini-outline" className={classes.outline} aria-label="On this page" tabIndex={0} data-print="hide">
      <div className={classes.lines} aria-hidden>
        {outline.entries.map((heading) => (
          <i
            key={heading.id}
            className={classes.dash}
            data-deep={heading.level >= deepFrom ? 'true' : 'false'}
            data-active={heading.id === outline.activeId ? 'true' : 'false'}
          />
        ))}
      </div>
      <div data-testid="mini-outline-panel" className={classes.panel}>
        <ReaderToc outline={outline} />
      </div>
    </nav>
  );
}
