import {
  useEffect, useRef, useState,
  type FocusEvent, type JSX, type KeyboardEvent, type MutableRefObject, type ReactNode, type SyntheticEvent,
} from 'react';

import { IconX } from '../icons';
import { caretOf } from '../shell/naming';
import { layout } from '../theme';

import classes from './NameField.module.css';
import { useTouchScreen } from './TapGuard';

export interface NameFieldProps {
  initial: string;
  isDir: boolean;
  label: string;
  testId: string;
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  keepOnBlur?: boolean;
  commitRef?: MutableRefObject<(() => void) | undefined>;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

export function NameField({
  initial, isDir, label, testId, placeholder, icon, className, keepOnBlur = false, commitRef, onSubmit, onCancel,
}: NameFieldProps): JSX.Element {
  const touch = useTouchScreen();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const state = useRef({ name, busy: false, done: false });
  state.current.name = name;

  const cancel = (): void => {
    if (state.current.done) {
      return;
    }
    state.current.done = true;
    onCancel();
  };

  const commit = (): void => {
    const now = state.current;
    if (now.busy || now.done) {
      return;
    }
    if (now.name.trim() === '') {
      cancel();
      return;
    }
    now.busy = true;
    setBusy(true);
    void onSubmit(now.name).then((saved) => {
      now.busy = false;
      now.done = saved;
      setBusy(false);
    });
  };

  const latest = useRef({ commit, cancel });
  latest.current = { commit, cancel };

  useEffect(() => {
    if (commitRef === undefined) {
      return undefined;
    }
    const own = (): void => latest.current.commit();
    commitRef.current = own;
    return () => {
      if (commitRef.current === own) {
        commitRef.current = undefined;
      }
    };
  }, [commitRef]);

  useEffect(() => {
    if (!touch) {
      return undefined;
    }
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node && boxRef.current?.contains(event.target) === true)) {
        latest.current.commit();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [touch]);

  const keepFocus = (event: SyntheticEvent): void => {
    if (!(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
    }
  };

  return (
    <span
      ref={boxRef}
      data-testid={`${testId}-field`}
      className={className === undefined ? classes.field : `${classes.field} ${className}`}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
    >
      {icon}
      <input
        data-testid={`${testId}-input`}
        className={classes.input}
        autoFocus
        value={name}
        disabled={busy}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        onFocus={(event: FocusEvent<HTMLInputElement>) => {
          if (!placed.current) {
            placed.current = true;
            const at = caretOf(event.currentTarget.value, isDir);
            event.currentTarget.setSelectionRange(at, at);
          }
        }}
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={() => {
          if (!keepOnBlur || state.current.name.trim() === '') {
            commit();
          }
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          event.stopPropagation();
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
      />
      {touch && (
        <button
          type="button"
          data-testid={`${testId}-cancel`}
          className={classes.cancel}
          aria-label="Cancel"
          onClick={cancel}
        >
          <IconX size={layout.iconSizeSmall} />
        </button>
      )}
    </span>
  );
}
