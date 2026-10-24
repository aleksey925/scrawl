import { createContext, useContext } from 'react';

// SearchControl is the search of the space: whether it is up, a way to open it,
// with text in its field when it is given, and one to put it away. The app
// provides it; a site has no search and leaves it out, so the reader asks for
// it and never imports the search itself.
export interface SearchControl {
  opened: boolean;
  open: (text?: string) => void;
  close: () => void;
}

const SearchControlContext = createContext<SearchControl | undefined>(undefined);

export const SearchControlProvider = SearchControlContext.Provider;

export function useSearchControl(): SearchControl | undefined {
  return useContext(SearchControlContext);
}
