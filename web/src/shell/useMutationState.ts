import { useCallback, type ReactNode } from 'react';

import type { MutationState } from '../api/types';
import { forgetResponses } from '../api/useApi';
import { showMutation, type ToastAction } from '../toast';

import { useAccount } from './NavContext';

export function useMutationState(): (state: MutationState | undefined, message: ReactNode, action?: ToastAction) => void {
  const { refreshMe } = useAccount();
  return useCallback(
    (state, message, action) => {
      forgetResponses();
      showMutation(state, message, action);
      refreshMe();
    },
    [refreshMe],
  );
}
