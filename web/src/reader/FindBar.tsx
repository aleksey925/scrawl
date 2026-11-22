import { ActionIcon } from '@mantine/core';
import { useEffect, useRef, type JSX, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';

import { IconChevronDown, IconChevronUp, IconSearch, IconX } from '../icons';
import { composing, ownsShortcuts } from '../shell/shortcuts';
import { keyboardShown } from '../shell/useVisibleArea';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './FindBar.module.css';
import { optionKeys, withOption, type FindOption } from './findOptions';
import { FindToggles } from './FindToggles';
import type { FindOnPage } from './useFindOnPage';

function counterOf(find: FindOnPage): string {
  switch (find.status) {
    case 'found':
      return `${find.position} of ${find.total}`;
    case 'none':
      return 'No results';
    case 'bad':
      return 'Bad pattern';
    case 'slow':
      return 'Pattern too slow';
    default:
      return '';
  }
}

function keepField(event: ReactMouseEvent): void {
  event.preventDefault();
}

export function FindBar({ find, docked = false }: { find: FindOnPage; docked?: boolean }): JSX.Element {
  const bar = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const atBottom = useBelow(layoutBreakpoints.phone);
  const { query, setQuery } = find;
  const toggle = (name: FindOption): void => setQuery(withOption(query, name));

  useEffect(() => {
    const view = window.visualViewport;
    if (view === null) {
      return undefined;
    }
    const follow = (): void => {
      const element = bar.current;
      if (element === null) {
        return;
      }
      if (docked) {
        element.dataset.keyboard = keyboardShown(view) ? 'true' : 'false';
        return;
      }
      if (atBottom) {
        element.style.transform = '';
        element.style.setProperty('--scrawl-find-bottom', `${view.offsetTop + view.height}px`);
        element.dataset.keyboard = keyboardShown(view) ? 'true' : 'false';
        return;
      }
      element.style.removeProperty('--scrawl-find-bottom');
      element.style.transform = Math.abs(view.offsetTop) < 1 ? '' : `translateY(${view.offsetTop}px)`;
      element.dataset.keyboard = 'false';
    };
    follow();
    view.addEventListener('scroll', follow);
    view.addEventListener('resize', follow);
    window.addEventListener('scroll', follow);
    return () => {
      view.removeEventListener('scroll', follow);
      view.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow);
    };
  }, [atBottom, docked]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [find.openings]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (composing(event.nativeEvent)) {
      return;
    }
    if (event.altKey) {
      const name = optionKeys[event.nativeEvent.code];
      if (name !== undefined) {
        event.preventDefault();
        toggle(name);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      find.close();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (find.status === 'idle') {
        find.run();
        return;
      }
      find.step(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div
      ref={bar}
      data-testid="doc-find"
      className={docked ? `${classes.bar} ${classes.docked}` : classes.bar}
      role="search"
      data-print="hide"
      {...ownsShortcuts}
    >
      <IconSearch size={layout.iconSizeSmall} className={classes.icon} />
      <input
        ref={input}
        data-testid="doc-find-input"
        className={classes.input}
        value={query.text}
        placeholder="Find in the note"
        aria-label="Find in the note"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        enterKeyHint="search"
        onChange={(event) => setQuery({ ...query, text: event.currentTarget.value })}
        onKeyDown={onKeyDown}
      />
      <span
        data-testid="doc-find-count"
        data-status={find.status}
        data-position={find.position}
        data-total={find.total}
        className={classes.count}
        role="status"
      >
        {counterOf(find)}
      </span>
      <span className={classes.break} aria-hidden />
      <FindToggles options={query} testIdPrefix="doc-find" className={classes.toggle} onToggle={toggle} onMouseDown={keepField} />
      <ActionIcon data-testid="doc-find-prev" className={classes.prev} variant="subtle" color="gray" aria-label="Previous match"
        disabled={find.total === 0} onMouseDown={keepField} onClick={() => find.step(-1)}>
        <IconChevronUp size={layout.iconSizeSmall} />
      </ActionIcon>
      <ActionIcon data-testid="doc-find-next" className={classes.next} variant="subtle" color="gray" aria-label="Next match"
        disabled={find.total === 0} onMouseDown={keepField} onClick={() => find.step(1)}>
        <IconChevronDown size={layout.iconSizeSmall} />
      </ActionIcon>
      <ActionIcon data-testid="doc-find-close" className={classes.close} variant="subtle" color="gray" aria-label="Close the find" onClick={find.close}>
        <IconX size={layout.iconSizeSmall} />
      </ActionIcon>
    </div>
  );
}
