import { Modal, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconFileText, IconSearch } from '../icons';
import {
  useCallback, useEffect, useMemo, useState,
  type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router';

import { api } from '../api/client';
import type { SearchResponse, SearchSettings } from '../api/types';
import { errorText } from '../api/useApi';
import { documentUrl } from '../paths';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { useRecentNotes } from './recentNotes';
import classes from './Search.module.css';
import { SearchControlProvider, SearchOpenerProvider, type SearchControl } from './searchOpener';
import { SearchResults, targetsOf } from './SearchResults';
import { appShortcut } from './shortcuts';

const debounceMs = 200;
const resultLimit = 30;

export const defaultSettings: SearchSettings = { mode: 'fuzzy', matchCase: false, word: false, regex: false, titles: false };

// hintOf says what the field matches the way the settings stand
export function hintOf(settings: SearchSettings): string {
  if (settings.regex) {
    return 'Regular expression over the text as shown, line by line';
  }
  return settings.mode === 'exact' ? 'The text exactly as typed' : 'Words in any order, one typo per word is fine';
}

// Case and Whole word are the toggles of Exact; Regex turns Fuzzy off
export function togglesOn(settings: SearchSettings): boolean {
  return settings.mode === 'exact' || settings.regex;
}

// withToggle flips one toggle by the key Alt is held with. The key is read by
// its code: on a Mac Option+C types ç, and the letter is no use
export function withToggle(settings: SearchSettings, code: string): SearchSettings | undefined {
  switch (code) {
    case 'KeyC':
      return togglesOn(settings) ? { ...settings, matchCase: !settings.matchCase } : settings;
    case 'KeyW':
      return togglesOn(settings) ? { ...settings, word: !settings.word } : settings;
    case 'KeyR':
      return { ...settings, regex: !settings.regex };
    case 'KeyF':
      return settings.regex ? settings : { ...settings, mode: settings.mode === 'fuzzy' ? 'exact' : 'fuzzy' };
    default:
      return undefined;
  }
}

interface Answer {
  response?: SearchResponse;
  error?: string;
}

// SearchProvider holds the search of the space and opens it: on Cmd+K
// anywhere in the app, and for the sidebar row and the phone's icon through
// the opener it provides
export function SearchProvider({ children }: { children: ReactNode }): JSX.Element {
  const [opened, setOpened] = useState(false);
  const [initial, setInitial] = useState('');

  const open = useCallback((text?: string) => {
    setInitial(text ?? '');
    setOpened(true);
  }, []);
  const close = useCallback(() => setOpened(false), []);
  const control = useMemo<SearchControl>(() => ({ opened, open: () => open(), close }), [opened, open, close]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'k') {
        return;
      }
      if (!appShortcut(event)) {
        return;
      }
      event.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <SearchOpenerProvider value={open}>
      <SearchControlProvider value={control}>
        {children}
        {opened && <SearchDialog initial={initial} onClose={close} />}
      </SearchControlProvider>
    </SearchOpenerProvider>
  );
}

function SearchDialog({ initial, onClose }: { initial: string; onClose: () => void }): JSX.Element {
  const navigate = useNavigate();
  const phone = useBelow(layoutBreakpoints.compactTopbar);
  const { notes: recent } = useRecentNotes();
  const [text, setText] = useState(initial);
  const [settings, setSettings] = useState<SearchSettings>(defaultSettings);
  const [debounced] = useDebouncedValue(text, debounceMs);
  const [answer, setAnswer] = useState<Answer>({});
  const [active, setActive] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const query = debounced.trim();
  useEffect(() => {
    setExpanded(new Set());
    setActive(undefined);
    if (query === '') {
      setAnswer({});
      return undefined;
    }
    const controller = new AbortController();
    api.find(query, settings, resultLimit, { signal: controller.signal }).then(
      (response) => setAnswer({ response }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setAnswer({ error: errorText(error) });
        }
      },
    );
    return () => controller.abort();
  }, [query, settings]);

  const hits = useMemo(() => answer.response?.hits ?? [], [answer.response]);
  const targets = useMemo(() => targetsOf(hits, expanded), [hits, expanded]);

  const go = (url: string): void => {
    onClose();
    void navigate(url);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.altKey) {
      const next = withToggle(settings, event.nativeEvent.code);
      if (next !== undefined) {
        event.preventDefault();
        setSettings(next);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = targets.findIndex((target) => target.key === active);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = targets[Math.min(Math.max(at + step, 0), targets.length - 1)];
      setActive(next?.key);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = targets.find((entry) => entry.key === active) ?? targets[0];
      if (target !== undefined) {
        go(target.url);
      }
    }
  };

  const toggles = togglesOn(settings);
  const matches = hits.reduce((sum, hit) => sum + (hit.match_count ?? 0), 0);

  return (
    <Modal
      opened
      onClose={onClose}
      size={755}
      yOffset="10vh"
      fullScreen={phone}
      withCloseButton={false}
      padding={0}
      radius="xl"
      shadow="lg"
      trapFocus
    >
      <div data-testid="search-dialog" className={classes.dialog} style={phone ? { maxHeight: 'none', height: '100dvh' } : undefined}>
        <div className={classes.inputRow}>
          <div className={classes.field}>
            <IconSearch size={layout.iconSize} />
            <input
              data-testid="search-input"
              className={classes.input}
              value={text}
              autoFocus
              placeholder="Search the space"
              aria-label="Search the space"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <div className={classes.toggles}>
              <Toggle testId="search-case" label="Match case" on={settings.matchCase} disabled={!toggles}
                onClick={() => setSettings({ ...settings, matchCase: !settings.matchCase })}>
                Aa
              </Toggle>
              <Toggle testId="search-word" label="Whole word" on={settings.word} disabled={!toggles}
                onClick={() => setSettings({ ...settings, word: !settings.word })}>
                <u>ab</u>
              </Toggle>
              <Toggle testId="search-regex" label="Regular expression" on={settings.regex}
                onClick={() => setSettings({ ...settings, regex: !settings.regex })}>
                .*
              </Toggle>
            </div>
          </div>
          {phone && (
            <button type="button" data-testid="search-close" className={classes.cancel} onClick={onClose}>
              Cancel
            </button>
          )}
        </div>

        <div className={classes.options}>
          <SegmentedControl
            data-testid="search-mode"
            data-mode={settings.mode}
            size="xs"
            value={settings.mode}
            disabled={settings.regex}
            onChange={(value) => setSettings({ ...settings, mode: value === 'exact' ? 'exact' : 'fuzzy' })}
            data={[
              { value: 'fuzzy', label: 'Fuzzy' },
              { value: 'exact', label: 'Exact' },
            ]}
          />
          <button
            type="button"
            data-testid="search-titles"
            data-on={settings.titles ? 'true' : 'false'}
            className={classes.chip}
            onClick={() => setSettings({ ...settings, titles: !settings.titles })}
          >
            Titles only
          </button>
          <span data-testid="search-hint" className={classes.hint}>
            {hintOf(settings)}
          </span>
        </div>

        <div className={classes.body}>
          {query === '' ? (
            <Recent notes={recent} onOpen={onClose} />
          ) : answer.error !== undefined ? (
            <div data-testid="search-error" className={classes.error}>
              {answer.error}
            </div>
          ) : answer.response !== undefined && hits.length === 0 ? (
            <div data-testid="search-empty" className={classes.empty}>
              No notes match that.
            </div>
          ) : (
            <SearchResults
              hits={hits}
              active={active}
              expanded={expanded}
              onExpand={(path) => setExpanded((prev) => new Set(prev).add(path))}
              onOpen={onClose}
            />
          )}
        </div>

        <div data-testid="search-footer" className={classes.footer}>
          {!phone && (
            <>
              <span>
                <kbd>↑↓</kbd>Select
              </span>
              <span>
                <kbd>↵</kbd>Open
              </span>
              <span>
                <kbd>⌥F</kbd>Fuzzy or exact
              </span>
            </>
          )}
          {answer.response !== undefined && query !== '' && (
            <span data-testid="search-stats" className={classes.stats}>
              {matches} {matches === 1 ? 'match' : 'matches'} in {hits.length} {hits.length === 1 ? 'note' : 'notes'},{' '}
              {answer.response.elapsed_ms} ms{answer.response.truncated === true ? ', stopped early' : ''}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface ToggleProps {
  testId: string;
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function Toggle({ testId, label, on, disabled = false, onClick, children }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      data-on={on ? 'true' : 'false'}
      className={classes.toggle}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Recent is what the dialog shows before anything is typed: the notes opened
// last in this browser
function Recent({ notes, onOpen }: { notes: ReturnType<typeof useRecentNotes>['notes']; onOpen: () => void }): JSX.Element {
  if (notes.length === 0) {
    return (
      <div data-testid="search-recent-empty" className={classes.empty}>
        Type to search every note in the space.
      </div>
    );
  }
  return (
    <div data-testid="search-recent">
      <div className={classes.group}>Recent</div>
      {notes.map((note) => (
        <Link key={note.path} data-testid="search-recent-item" to={documentUrl(note.path)} className={classes.head} onClick={onOpen}>
          <IconFileText size={layout.iconSizeSmall} />
          <span className={classes.title}>{note.title === '' ? note.path : note.title}</span>
          <span className={classes.path}>{note.path}</span>
        </Link>
      ))}
    </div>
  );
}
