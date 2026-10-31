import { mountBase } from '../mount';

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
