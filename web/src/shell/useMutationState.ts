import { useCallback } from 'react';

import type { MutationState } from '../api/types';
import { forgetResponses } from '../api/useApi';
import { showMutation } from '../toast';

import { useNav } from './NavContext';

// useMutationState reports one change and then settles the screen.
//
// The toast helper it wraps is a module-level function and cannot read context,
// which is why the refresh lives here instead. It refreshes always and not only
// when the state is dirty: a save that finally pushed would otherwise leave the
// previous warning standing until the next poll.
//
// The cached answers go with it: a screen that paints from one is showing what
// this very change has just made wrong.
export function useMutationState(): (state: MutationState | undefined, message: string) => void {
  const { refreshMe } = useNav();
  return useCallback(
    (state, message) => {
      forgetResponses();
      showMutation(state, message);
      refreshMe();
    },
    [refreshMe],
  );
}
