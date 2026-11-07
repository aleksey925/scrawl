import {
  useEffect, useRef, useState,
  type FocusEvent, type JSX, type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject, type SyntheticEvent,
} from 'react';

import { IconX } from '../icons';
import { caretOf } from '../shell/naming';
import { layout } from '../theme';

import classes from './NameField.module.css';
import { useTouchScreen } from './TapGuard';

const imeKeyCode = 229;

interface FieldState {
  busy: boolean;
  done: boolean;
  failed: string | undefined;
}

export interface NameFieldProps {
  initial: string;
  isDir?: boolean;
  label: string;
  testId: string;
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  keepOnLeave?: boolean;
  commitRef?: MutableRefObject<(() => void) | undefined>;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

function useOutsideTap(boxRef: RefObject<HTMLElement | null>, onTap: () => void): void {
  const touch = useTouchScreen();
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  useEffect(() => {
    if (!touch) {
      return undefined;
    }
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node && boxRef.current?.contains(event.target) === true)) {
        onTapRef.current();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [boxRef, touch]);
}

export function NameField({
  initial, isDir = false, label, testId, placeholder, icon, className, keepOnLeave = false, commitRef, onSubmit, onCancel,
}: NameFieldProps): JSX.Element {
  const touch = useTouchScreen();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const placed = useRef(false);
  const refocus = useRef(false);
  const state = useRef<FieldState>({ busy: false, done: false, failed: undefined });

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
    if (name.trim() === '') {
      cancel();
      return;
    }
    const sent = name;
    const focused = document.activeElement === inputRef.current;
    now.busy = true;
    setBusy(true);
    void onSubmit(sent).then((saved) => {
      now.busy = false;
      now.done = saved;
      now.failed = saved ? undefined : sent;
      refocus.current = !saved && focused;
      setBusy(false);
    });
  };

  const leave = (): void => {
    const now = state.current;
    if ((keepOnLeave && name.trim() !== '') || name === now.failed) {
      return;
    }
    commit();
  };

  const leaveOnBlur = (): void => {
    if (document.activeElement === inputRef.current && !document.hasFocus()) {
      return;
    }
    leave();
  };

  const leaveOrClose = (): void => {
    if (name === state.current.failed) {
      cancel();
      return;
    }
    leave();
  };

  const leaveRef = useRef(leaveOrClose);
  leaveRef.current = leaveOrClose;
  useOutsideTap(boxRef, leave);

  useEffect(() => {
    if (!busy && refocus.current) {
      refocus.current = false;
      const active = document.activeElement;
      if (active === null || active === document.body || active === inputRef.current) {
        inputRef.current?.focus();
      }
    }
  }, [busy]);

  useEffect(() => {
    if (commitRef === undefined) {
      return undefined;
    }
    const own = (): void => leaveRef.current();
    commitRef.current = own;
    return () => {
      if (commitRef.current === own) {
        commitRef.current = undefined;
      }
    };
  }, [commitRef]);

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
        ref={inputRef}
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
        onBlur={leaveOnBlur}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          event.stopPropagation();
          const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === imeKeyCode;
          if (event.key === 'Enter' && !composing) {
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
          tabIndex={-1}
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
