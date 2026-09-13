import { useDebouncedValue } from '@mantine/hooks';
import { Spotlight, type SpotlightActionData } from '@mantine/spotlight';
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../api/client';
import type { SearchHit } from '../api/types';
import { documentUrl } from '../paths';

const searchLimit = 10;

export function SearchSpotlight(): JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 200);
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (debounced.trim() === '') {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    api
      .search(debounced, searchLimit, { signal: controller.signal })
      .then((response) => setHits(response.hits))
      .catch(() => {
        if (!controller.signal.aborted) {
          setHits([]);
        }
      });
    return () => controller.abort();
  }, [debounced]);

  const actions: SpotlightActionData[] = hits.map((hit) => ({
    id: hit.path,
    label: hit.title === '' ? hit.path : hit.title,
    description: hit.path,
    onClick: () => void navigate(documentUrl(hit.path)),
  }));

  return (
    <Spotlight
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      filter={(_, all) => all}
      nothingFound="No notes match that"
      shortcut={['mod + K', '/']}
      searchProps={{
        leftSection: <IconSearch size={18} />,
        placeholder: 'Search your notes',
      }}
    />
  );
}
