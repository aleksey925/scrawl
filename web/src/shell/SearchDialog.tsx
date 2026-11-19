import { Modal } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router';

import { api, searchTextOf } from '../api/client';
import type { SearchMode, SearchResponse, SearchSettings } from '../api/types';
import { errorText } from '../api/useApi';
import { Segmented, type SegmentedOption } from '../components/Segmented';
import { IconFileText, IconSearch, IconX } from '../icons';
import { documentUrl } from '../paths';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { useRecentNotes, type RecentNote } from './recentNotes';
import picker from './Picker.module.css';
import classes from './Search.module.css';
import { hintOf, SearchResults, targetsOf } from './SearchResults';
import { altKey, keysLabel } from './shortcuts';
import { useFullScreenStyle } from './useVisibleArea';

const debounceMs = 200;
const resultLimit = 30;

const modeOptions: SegmentedOption<SearchMode>[] = [
  { value: 'fuzzy', label: 'Fuzzy' },
  { value: 'exact', label: 'Exact' },
];

const defaultSettings: SearchSettings = { mode: 'fuzzy', matchCase: false, word: false, regex: false, titles: false };

function togglesOn(settings: SearchSettings): boolean {
  return settings.mode === 'exact' || settings.regex;
}

function withToggle(settings: SearchSettings, code: string): SearchSettings | undefined {
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
  query?: string;
  settings?: SearchSettings;
  response?: SearchResponse;
  error?: string;
}

export interface SearchDialogProps {
  initial: string;
  offline: boolean;
  onClose: () => void;
}

export function SearchDialog({ initial, offline, onClose }: SearchDialogProps): JSX.Element {
  const navigate = useNavigate();
  const phone = useBelow(layoutBreakpoints.phone);
  const screenStyle = useFullScreenStyle(phone);
  const { notes: recent, clear: clearRecent } = useRecentNotes();
  const [text, setText] = useState(initial);
  const [settings, setSettings] = useState<SearchSettings>(defaultSettings);
  const [debounced] = useDebouncedValue(text, debounceMs);
  const [answer, setAnswer] = useState<Answer>({});
  const [active, setActive] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [openPending, setOpenPending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const query = offline ? '' : searchTextOf(debounced, settings);
  const empty = query.trim() === '';
  useEffect(() => {
    setExpanded(new Set());
    setActive(undefined);
    if (query.trim() === '') {
      setAnswer({ query, settings });
      return undefined;
    }
    const controller = new AbortController();
    api.find(query, settings, resultLimit, { signal: controller.signal }).then(
      (response) => setAnswer({ query, settings, response }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setAnswer({ query, settings, error: errorText(error) });
        }
      },
    );
    return () => controller.abort();
  }, [query, settings]);

  const hits = useMemo(() => answer.response?.hits ?? [], [answer.response]);
  const expand = useCallback((path: string): void => setExpanded((prev) => new Set(prev).add(path)), []);
  const targets = useMemo(() => targetsOf(hits, expanded), [hits, expanded]);
  const answered = searchTextOf(text, settings) === query && answer.query === query && answer.settings === settings;

  const go = useCallback(
    (url: string): void => {
      onClose();
      void navigate(url);
    },
    [onClose, navigate],
  );

  useEffect(() => {
    if (!openPending || !answered) {
      return;
    }
    setOpenPending(false);
    const target = targets[0];
    if (target !== undefined) {
      go(target.url);
    }
  }, [openPending, answered, targets, go]);

  useEffect(() => {
    bodyRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

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
      const at = targets.findIndex((entry) => entry.key === active);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = targets[Math.min(Math.max(at + step, 0), targets.length - 1)];
      setActive(next?.key);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!answered) {
        setOpenPending(true);
        return;
      }
      const target = targets.find((entry) => entry.key === active) ?? targets[0];
      if (target !== undefined) {
        go(target.url);
      }
    }
  };

  const toggles = togglesOn(settings);
  const matches = hits.reduce((sum, row) => sum + (row.match_count ?? 0), 0);

  const icon = <IconSearch size={layout.iconSize} />;
  const input = (
    <input
      data-testid="search-input"
      className={picker.input}
      value={offline ? '' : text}
      autoFocus={!offline}
      data-autofocus={offline ? undefined : true}
      disabled={offline}
      placeholder="Search the space"
      aria-label="Search the space"
      autoComplete="off"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      enterKeyHint="search"
      onChange={(event) => {
        setText(event.currentTarget.value);
        setOpenPending(false);
      }}
      onKeyDown={onKeyDown}
    />
  );
  const toggleButtons = (
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
  );
  const modeControls = (
    <>
      <Segmented
        data-testid="search-mode"
        data-mode={settings.mode}
        className={phone ? classes.phoneMode : undefined}
        size="xs"
        value={settings.mode}
        disabled={settings.regex}
        onChange={(mode) => setSettings({ ...settings, mode })}
        options={modeOptions}
      />
      <button
        type="button"
        data-testid="search-titles"
        data-on={settings.titles ? 'true' : 'false'}
        aria-pressed={settings.titles}
        className={classes.chip}
        onClick={() => setSettings({ ...settings, titles: !settings.titles })}
      >
        Titles only
      </button>
    </>
  );
  const hint = (
    <span data-testid="search-hint" className={classes.hint}>
      {hintOf(settings)}
    </span>
  );
  const stats = answer.response !== undefined && !empty && (
    <span data-testid="search-stats" className={classes.stats}>
      {matches} {matches === 1 ? 'match' : 'matches'} in {hits.length} {hits.length === 1 ? 'note' : 'notes'},{' '}
      {answer.response.elapsed_ms} ms{answer.response.truncated === true ? ', stopped early' : ''}
    </span>
  );
  const body = (
    <div ref={bodyRef} className={phone ? `${picker.body} ${classes.phoneBody}` : picker.body}>
      {empty ? (
        phone ? (
          <PhoneRecent notes={recent} offline={offline} onOpen={onClose} onClear={clearRecent} />
        ) : (
          <Recent notes={recent} onOpen={onClose} />
        )
      ) : answer.error !== undefined ? (
        <div data-testid="search-error" className={classes.error}>
          {answer.error}
        </div>
      ) : answer.response !== undefined && hits.length === 0 ? (
        <div data-testid="search-empty" className={picker.empty}>
          No notes match that.
        </div>
      ) : (
        <SearchResults
          hits={hits}
          active={active}
          expanded={expanded}
          onExpand={expand}
          onOpen={onClose}
        />
      )}
    </div>
  );

  return (
    <Modal
      opened
      onClose={onClose}
      size={755}
      yOffset="10vh"
      fullScreen={phone}
      withCloseButton={false}
      padding={0}
      trapFocus
    >
      {phone ? (
        <div
          data-testid="search-dialog"
          data-offline={offline ? 'true' : 'false'}
          className={classes.screen}
          style={screenStyle}
        >
          {body}
          {stats !== false && (
            <div data-testid="search-footer" className={classes.phoneStats}>
              {stats}
            </div>
          )}
          <div data-testid="search-card" role="search" className={classes.card} data-print="hide">
            {!offline && <div className={classes.cardOptions}>{modeControls}</div>}
            {offline ? (
              <span data-testid="search-offline" className={classes.hint}>
                Search needs the network
              </span>
            ) : (
              hint
            )}
            <div className={classes.fieldRow}>
              {icon}
              {input}
              {!offline && toggleButtons}
              <button
                type="button"
                data-testid="search-close"
                className={classes.close}
                aria-label="Cancel search"
                title="Cancel search"
                onClick={onClose}
              >
                <IconX size={layout.iconSize} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div data-testid="search-dialog" className={picker.dialog}>
          <div className={picker.inputRow}>
            <div className={picker.field}>
              {icon}
              {input}
              {toggleButtons}
            </div>
          </div>
          <div className={classes.options}>
            {modeControls}
            {hint}
          </div>
          {body}
          <div data-testid="search-footer" className={picker.footer}>
            <span>
              <kbd>↑↓</kbd>Select
            </span>
            <span>
              <kbd>↵</kbd>Open
            </span>
            <span>
              <kbd>{keysLabel(altKey, 'F')}</kbd>Fuzzy or exact
            </span>
            {stats}
          </div>
        </div>
      )}
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

function Recent({ notes, onOpen }: { notes: readonly RecentNote[]; onOpen: () => void }): JSX.Element {
  if (notes.length === 0) {
    return (
      <div data-testid="search-recent-empty" className={picker.empty}>
        Type to search every note in the space.
      </div>
    );
  }
  return (
    <div data-testid="search-recent">
      <div className={classes.group}>Recent</div>
      {notes.map((recent) => (
        <Link key={recent.path} data-testid="search-recent-item" to={documentUrl(recent.path)} className={picker.head} onClick={onOpen}>
          <IconFileText size={layout.iconSizeSmall} />
          <span className={picker.title}>{recent.title === '' ? recent.path : recent.title}</span>
          <span className={picker.path}>{recent.path}</span>
        </Link>
      ))}
    </div>
  );
}

interface PhoneRecentProps {
  notes: readonly RecentNote[];
  offline: boolean;
  onOpen: () => void;
  onClear: () => void;
}

function PhoneRecent({ notes, offline, onOpen, onClear }: PhoneRecentProps): JSX.Element {
  if (notes.length === 0) {
    return (
      <div data-testid="search-recent-empty" className={picker.empty}>
        {offline ? 'The notes you open on this device are listed here.' : 'Type to search every note in the space.'}
      </div>
    );
  }
  return (
    <div data-testid="search-recent">
      <div className={classes.recentHead}>
        <span>Recent</span>
        <button type="button" data-testid="search-recent-clear" className={classes.recentClear} onClick={onClear}>
          Clear
        </button>
      </div>
      <div className={classes.rows}>
        {notes.map((recent) => (
          <Link
            key={recent.path}
            data-testid="search-recent-item"
            data-path={recent.path}
            to={documentUrl(recent.path)}
            className={classes.recentRow}
            onClick={onOpen}
          >
            <IconFileText size={layout.iconSizeRow} aria-hidden />
            <span className={classes.recentText}>
              <span className={classes.recentTitle}>{recent.title === '' ? recent.path : recent.title}</span>
              <span className={classes.recentPath}>{recent.path}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
