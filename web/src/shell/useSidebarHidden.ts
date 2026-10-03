import { useCallback, useEffect, useState } from 'react';

import { localStore, readText, writeText } from '../storage';

const hiddenKey = 'scrawl.sidebar.hidden';

export interface SidebarVisibility {
  hidden: boolean;
  toggle: () => void;
}

// hiding the tree is a choice about the whole app rather than about one note,
// so it outlives the navigation that follows it and the tab it was made in
export function useSidebarHidden(): SidebarVisibility {
  const [hidden, setHidden] = useState(() => readText(localStore(), hiddenKey) === 'true');

  useEffect(() => {
    writeText(localStore(), hiddenKey, String(hidden));
  }, [hidden]);

  return { hidden, toggle: useCallback(() => setHidden((was) => !was), []) };
}
