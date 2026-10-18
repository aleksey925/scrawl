import { useEffect } from 'react';
import { useLocation } from 'react-router';

import type { DocumentExtrasProps } from '../shell/extensions';

import { useHistoryPlaced } from './SiteRouter';

// HistoryPlacement tells the note that Back is putting it where it was left, so
// the heading its hash names does not pull it away from there
export function HistoryPlacement({ placed }: DocumentExtrasProps): null {
  const location = useLocation();
  const placedKey = useHistoryPlaced();

  useEffect(() => {
    placed.current = placedKey !== undefined && placedKey === location.key;
  }, [placed, placedKey, location.key]);

  return null;
}
