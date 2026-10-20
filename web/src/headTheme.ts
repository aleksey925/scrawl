import { autoTheme, lookupTheme, type Scheme } from './themes';

const touchIconName = /apple-touch-icon(?:-dark)?\.png/;
const schemes: readonly Scheme[] = ['light', 'dark'];

function touchIconOf(href: string, scheme: Scheme): string {
  return href.replace(touchIconName, scheme === 'dark' ? 'apple-touch-icon-dark.png' : 'apple-touch-icon.png');
}

function mediaOf(scheme: Scheme): string {
  return `(prefers-color-scheme: ${scheme})`;
}

// syncHead puts the browser's own chrome on the theme picked: the color of its
// bar and the icon a phone puts on its home screen. The server wrote both for
// the theme it was asked for, and the picker reloads nothing, so after a pick
// the bar kept the old color and a phone took the old icon. Auto gets one of
// each per scheme, behind the system preference, as the server writes them.
export function syncHead(choice: string): void {
  const picked = lookupTheme(choice);
  const wanted = picked === undefined ? schemes.map((scheme) => ({ scheme, media: mediaOf(scheme) })) : [{ scheme: picked.scheme, media: '' }];

  const metas = Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  if (metas.length > 0) {
    metas.forEach((meta) => meta.remove());
    for (const { scheme, media } of wanted) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = (picked ?? autoTheme(scheme)).palette.bg;
      if (media !== '') {
        meta.media = media;
      }
      document.head.append(meta);
    }
  }

  const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'));
  const base = links[0]?.getAttribute('href');
  if (base === null || base === undefined) {
    return;
  }
  links.forEach((link) => link.remove());
  for (const { scheme, media } of wanted) {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = touchIconOf(base, scheme);
    if (media !== '') {
      link.media = media;
    }
    document.head.append(link);
  }
}
