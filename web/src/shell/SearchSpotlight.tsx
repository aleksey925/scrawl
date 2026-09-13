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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const wanted = debounced.trim();
    if (wanted === '') {
      setHits([]);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    api
      .search(wanted, searchLimit, { signal: controller.signal })
      .then((response) => {
        setHits(response.hits);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHits([]);
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [debounced]);

  const typed = query.trim();
  const actions: SpotlightActionData[] = hits.map((hit) => ({
    id: hit.path,
    label: hit.title === '' ? hit.path : hit.title,
    description: hit.path,
    onClick: () => void navigate(`${documentUrl(hit.path)}?q=${encodeURIComponent(typed)}`),
  }));

  // only offered beside real hits: standing alone it would cover the empty
  // state, and "no notes match" must stay distinguishable from a failed search
  if (actions.length > 0) {
    actions.push({
      id: 'search-all-notes',
      label: `Search all notes for "${typed}"`,
      description: 'Open the search page',
      onClick: () => void navigate(`/search?q=${encodeURIComponent(typed)}`),
    });
  }

  return (
    <Spotlight
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      filter={(_, all) => all}
      nothingFound={
        failed ? 'Search is unavailable right now. Try again in a moment.' : 'No notes match that'
      }
      shortcut={['mod + K', '/']}
      searchProps={{
        leftSection: <IconSearch size={18} />,
        placeholder: 'Search your notes',
      }}
    />
  );
}
