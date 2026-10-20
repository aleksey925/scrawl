import { ActionIcon } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSearch, IconX } from '@tabler/icons-react';
import { useEffect, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react';

import { layout } from '../theme';

import classes from './FindBar.module.css';
import type { FindQuery } from './findMatches';
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

// withToggle flips a toggle by the key Alt is held with, read by its code: on
// a Mac Option+C types ç
function withToggle(query: FindQuery, code: string): FindQuery | undefined {
  switch (code) {
    case 'KeyC':
      return { ...query, matchCase: !query.matchCase };
    case 'KeyW':
      return { ...query, word: !query.word };
    case 'KeyR':
      return { ...query, regex: !query.regex };
    default:
      return undefined;
  }
}

// FindBar is the find of the note on screen: a field, the count, the toggles
// of case, whole word and regex, and the steps between the matches
export function FindBar({ find }: { find: FindOnPage }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const { query, setQuery } = find;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [find.openings]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.altKey) {
      const next = withToggle(query, event.nativeEvent.code);
      if (next !== undefined) {
        event.preventDefault();
        setQuery(next);
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
    <div data-testid="doc-find" className={classes.bar} role="search" data-print="hide">
      <IconSearch size={layout.iconSizeSmall} />
      <input
        ref={input}
        data-testid="doc-find-input"
        className={classes.input}
        value={query.text}
        placeholder="Find in the note"
        aria-label="Find in the note"
        autoComplete="off"
        spellCheck={false}
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
      <Toggle testId="doc-find-case" label="Match case" on={query.matchCase}
        onClick={() => setQuery({ ...query, matchCase: !query.matchCase })}>
        Aa
      </Toggle>
      <Toggle testId="doc-find-word" label="Whole word" on={query.word}
        onClick={() => setQuery({ ...query, word: !query.word })}>
        <u>ab</u>
      </Toggle>
      <Toggle testId="doc-find-regex" label="Regular expression" on={query.regex}
        onClick={() => setQuery({ ...query, regex: !query.regex })}>
        .*
      </Toggle>
      <ActionIcon data-testid="doc-find-prev" variant="subtle" color="gray" aria-label="Previous match"
        disabled={find.total === 0} onClick={() => find.step(-1)}>
        <IconChevronUp size={layout.iconSizeSmall} />
      </ActionIcon>
      <ActionIcon data-testid="doc-find-next" variant="subtle" color="gray" aria-label="Next match"
        disabled={find.total === 0} onClick={() => find.step(1)}>
        <IconChevronDown size={layout.iconSizeSmall} />
      </ActionIcon>
      <ActionIcon data-testid="doc-find-close" variant="subtle" color="gray" aria-label="Close the find" onClick={find.close}>
        <IconX size={layout.iconSizeSmall} />
      </ActionIcon>
    </div>
  );
}

interface ToggleProps {
  testId: string;
  label: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}

function Toggle({ testId, label, on, onClick, children }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      data-on={on ? 'true' : 'false'}
      className={classes.toggle}
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
