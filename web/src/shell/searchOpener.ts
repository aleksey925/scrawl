import { createContext, useContext } from 'react';

// SearchOpener opens the search of the space, with text in its field when it
// is given. The app provides it; a site has no search and leaves it out, so
// the reader asks for it and never imports the search itself.
export type SearchOpener = (text?: string) => void;

const SearchOpenerContext = createContext<SearchOpener | undefined>(undefined);

export const SearchOpenerProvider = SearchOpenerContext.Provider;

export function useSearchOpener(): SearchOpener | undefined {
  return useContext(SearchOpenerContext);
}

// SearchControl is the search as the phone's bar of tabs needs it: whether it
// is up, and a way to put it away before a tab does what it does
export interface SearchControl {
  opened: boolean;
  open: () => void;
  close: () => void;
}

const SearchControlContext = createContext<SearchControl | undefined>(undefined);

export const SearchControlProvider = SearchControlContext.Provider;

export function useSearchControl(): SearchControl | undefined {
  return useContext(SearchControlContext);
}
