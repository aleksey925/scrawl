import { useEffect } from 'react';
import { useLocation } from 'react-router';

import type { DocumentExtrasProps } from '../shell/extensions';

import { useHistoryPlaced } from './SiteRouter';

export function HistoryPlacement({ placed }: DocumentExtrasProps): null {
  const location = useLocation();
  const placedKey = useHistoryPlaced();

  useEffect(() => {
    placed.current = placedKey !== undefined && placedKey === location.key;
  }, [placed, placedKey, location.key]);

  return null;
}
