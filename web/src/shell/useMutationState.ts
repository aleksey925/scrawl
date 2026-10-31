import { useCallback } from 'react';

import type { MutationState } from '../api/types';
import { forgetResponses } from '../api/useApi';
import { showMutation } from '../toast';

import { useNav } from './NavContext';

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
