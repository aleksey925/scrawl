// ChangeSignal is the half of an external store useSyncExternalStore listens
// to: who to tell, and telling them
export interface ChangeSignal {
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
}

export function changeSignal(): ChangeSignal {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: () => {
      for (const tell of listeners) {
        tell();
      }
    },
  };
}
