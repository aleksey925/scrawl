import { mountBase } from '../mount';

// the renderer rewrites a link to a note to this route and everything else to
// /raw/, which is a server route and not the client router's to answer. Both
// are physical - the browser would fetch either one directly - so the match is
// against the mounted prefix and the result is stripped back down to what the
// router expects, which prepends that very prefix again.
function documentRoute(): string {
  return `${mountBase()}/doc/`;
}

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
  if (url.origin !== window.location.origin || !url.pathname.startsWith(documentRoute())) {
    return undefined;
  }
  const routed = url.pathname.slice(mountBase().length);
  return { to: routed + url.search + url.hash };
}
