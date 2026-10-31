export const headingSelector = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]';

export function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function elementWithId(root: HTMLElement, id: string): HTMLElement | null {
  const wanted = decodeFragment(id);
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[id]'));
  for (const candidate of candidates) {
    if (candidate.id === id || decodeFragment(candidate.id) === wanted) {
      return candidate;
    }
  }
  const folded = wanted.toLowerCase();
  for (const candidate of candidates) {
    if (decodeFragment(candidate.id).toLowerCase() === folded) {
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
