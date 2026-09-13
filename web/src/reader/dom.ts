export const headingSelector = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]';

// the renderer percent encodes a Cyrillic fragment, so a href and the id it
// points at are not the same string
export function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// lookups stay inside the document root: a note heading slugged like a piece of
// app chrome must never answer for it
export function elementWithId(root: HTMLElement, id: string): HTMLElement | null {
  const wanted = decodeFragment(id);
  for (const candidate of root.querySelectorAll<HTMLElement>('[id]')) {
    if (candidate.id === id || decodeFragment(candidate.id) === wanted) {
      return candidate;
    }
  }
  return null;
}

export function headingsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(headingSelector));
}

export function imagesOf(root: HTMLElement): HTMLImageElement[] {
  return Array.from(root.querySelectorAll('img')).filter((image) => image.closest('a') === null);
}

export function imageCaption(image: HTMLImageElement): string {
  if (image.alt !== '') {
    return image.alt;
  }
  const name = image.getAttribute('src')?.split('/').pop() ?? '';
  return decodeFragment(name);
}
