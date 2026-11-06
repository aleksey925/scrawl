import { useCallback, type ReactNode } from 'react';

import type { MutationState } from '../api/types';
import { forgetResponses } from '../api/useApi';
import { showMutation, type ToastAction } from '../toast';

import { useNav } from './NavContext';

export function useMutationState(): (state: MutationState | undefined, message: ReactNode, action?: ToastAction) => void {
  const { refreshMe } = useNav();
  return useCallback(
    (state, message, action) => {
      forgetResponses();
      showMutation(state, message, action);
      refreshMe();
    },
    [refreshMe],
  );
}
