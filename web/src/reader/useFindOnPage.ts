import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

// katex and mermaid own their subtrees: a mark spliced into one corrupts the
// rendering, and .math is source that typesetting detaches marks from, leaving
// the bar counting hits that no longer exist
const skipSelector = 'script, style, svg, .katex, .math, .mermaid, .md-anchor, .md-copy';

const hitClass = 'md-find';

const minTermLength = 2;

// the terms come from the ?q= a search result carried over. Quotes only group a
// phrase for the index, so they are dropped before matching text on the page.
function queryTerms(query: string): string[] {
  return query
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= minTermLength);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markMatches(root: HTMLElement, terms: string[]): HTMLElement[] {
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      return (node.nodeValue ?? '').trim() !== '' && parent !== null && parent.closest(skipSelector) === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const texts: Node[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    texts.push(node);
  }

  const hits: HTMLElement[] = [];
  for (const node of texts) {
    const value = node.nodeValue ?? '';
    pattern.lastIndex = 0;
    if (!pattern.test(value)) {
      continue;
    }
    pattern.lastIndex = 0;
    const parts = document.createDocumentFragment();
    let last = 0;
    for (let found = pattern.exec(value); found !== null; found = pattern.exec(value)) {
      parts.append(document.createTextNode(value.slice(last, found.index)));
      const mark = document.createElement('mark');
      mark.className = hitClass;
      mark.textContent = found[0];
      parts.append(mark);
      hits.push(mark);
      last = found.index + found[0].length;
    }
    parts.append(document.createTextNode(value.slice(last)));
    node.parentNode?.replaceChild(parts, node);
  }
  return hits;
}

export interface FindOnPage {
  position: number;
  total: number;
  step: (delta: number) => void;
  close: () => void;
}

export function useFindOnPage(rootRef: RefObject<HTMLDivElement | null>, html: string): FindOnPage | null {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const query = searchParams.get('q') ?? '';

  const hits = useRef<HTMLElement[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [total, setTotal] = useState(0);

  const show = useCallback((at: number, behavior: ScrollBehavior): void => {
    const found = hits.current;
    if (found.length === 0) {
      return;
    }
    const next = (at + found.length) % found.length;
    found.forEach((mark, position) => {
      if (position === next) {
        mark.dataset.active = 'true';
      } else {
        delete mark.dataset.active;
      }
    });
    found[next]?.scrollIntoView({ block: 'center', behavior });
    setIndex(next);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const terms = queryTerms(query);
    if (root === null || terms.length === 0) {
      hits.current = [];
      setTotal(0);
      setIndex(null);
      return undefined;
    }

    const found = markMatches(root, terms);
    hits.current = found;
    setTotal(found.length);
    if (found.length === 0) {
      setIndex(null);
      return undefined;
    }
    // instant on arrival: the reader asked to be taken there, and animating the
    // whole page down to the match only delays it
    show(0, 'instant');

    return () => {
      for (const mark of found) {
        const parent = mark.parentNode;
        if (parent === null) {
          continue;
        }
        parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
        parent.normalize();
      }
      hits.current = [];
    };
  }, [rootRef, html, query, show]);

  // the query leaves the url with the highlighting, so a reload does not light
  // the page up again
  const close = useCallback((): void => {
    void navigate({ pathname: location.pathname, hash: location.hash }, { replace: true });
  }, [navigate, location.pathname, location.hash]);

  if (total === 0 || index === null) {
    return null;
  }
  return {
    position: index + 1,
    total,
    step: (delta: number) => show(index + delta, 'smooth'),
    close,
  };
}
