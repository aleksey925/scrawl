import { useCallback, useEffect, useState } from 'react';

import { localStore, readText, writeText } from '../storage';

const hiddenKey = 'scrawl.sidebar.hidden';

export interface SidebarVisibility {
  hidden: boolean;
  toggle: () => void;
}

export function useSidebarHidden(): SidebarVisibility {
  const [hidden, setHidden] = useState(() => readText(localStore(), hiddenKey) === 'true');

  useEffect(() => {
    writeText(localStore(), hiddenKey, String(hidden));
  }, [hidden]);

  return { hidden, toggle: useCallback(() => setHidden((was) => !was), []) };
}
