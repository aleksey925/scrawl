// the renderer rewrites a link to a note to this prefix and everything else to
// /raw/, which is a server route and not the client router's to answer
const documentRoute = '/p/';

export interface InternalTarget {
  to: string;
}

export function isPlainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

// internalTarget names the route a link belongs to, or nothing when the browser
// should keep the link: an external host, an attachment, a new tab
export function internalTarget(link: HTMLAnchorElement): InternalTarget | undefined {
  const href = link.getAttribute('href');
  if (href === null || href === '' || href.startsWith('#')) {
    return undefined;
  }
  if (link.target !== '' && link.target !== '_self') {
    return undefined;
  }
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith(documentRoute)) {
    return undefined;
  }
  return { to: url.pathname + url.search + url.hash };
}
