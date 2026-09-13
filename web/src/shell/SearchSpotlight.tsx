import { useDebouncedValue } from '@mantine/hooks';
import { Spotlight, type SpotlightActionData, type SpotlightSearchProps } from '@mantine/spotlight';
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../api/client';
import type { SearchHit } from '../api/types';
import { documentUrl } from '../paths';

const searchLimit = 10;

// Mantine takes these two as object literals rather than JSX, and an object
// literal has no waiver for hyphenated keys the way an attribute does
interface PaletteAction extends SpotlightActionData {
  'data-testid': string;
  'data-path'?: string;
}

interface PaletteSearch extends SpotlightSearchProps {
  'data-testid': string;
}

const searchProps: PaletteSearch = {
  leftSection: <IconSearch size={18} />,
  placeholder: 'Search your notes',
  'data-testid': 'palette-input',
};

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
  const actions: PaletteAction[] = hits.map((hit) => ({
    id: hit.path,
    label: hit.title === '' ? hit.path : hit.title,
    description: hit.path,
    onClick: () => void navigate(`${documentUrl(hit.path)}?q=${encodeURIComponent(typed)}`),
    'data-testid': 'palette-item',
    'data-path': hit.path,
  }));

  // only offered beside real hits: standing alone it would cover the empty
  // state, and "no notes match" must stay distinguishable from a failed search
  if (actions.length > 0) {
    actions.push({
      id: 'search-all-notes',
      label: `Search all notes for "${typed}"`,
      description: 'Open the search page',
      onClick: () => void navigate(`/search?q=${encodeURIComponent(typed)}`),
      'data-testid': 'palette-search-all',
    });
  }

  return (
    <Spotlight
      data-testid="palette"
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      filter={(_, all) => all}
      nothingFound={
        <span data-testid="palette-empty" data-kind={failed ? 'failed' : 'none'}>
          {failed ? 'Search is unavailable right now. Try again in a moment.' : 'No notes match that'}
        </span>
      }
      shortcut={['mod + K', '/']}
      searchProps={searchProps}
    />
  );
}
