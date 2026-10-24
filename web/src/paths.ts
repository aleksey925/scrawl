import { mountBase } from './mount';

const translit: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya',
};

export function slugify(title: string): string {
  let out = '';
  for (const letter of title.toLowerCase()) {
    out += translit[letter] ?? letter;
  }
  return out
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function slugPath(name: string): string {
  return name
    .split('/')
    .map(slugify)
    .filter((part) => part !== '')
    .join('/');
}

export function encodeContentPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

export function documentUrl(path: string): string {
  return `/doc/${encodeContentPath(path)}`;
}

export function directoryUrl(path: string): string {
  return path === '' ? '/' : `/doc/${encodeContentPath(path)}/`;
}

export function rawUrl(path: string): string {
  return `${mountBase()}/raw/${encodeContentPath(path)}`;
}

export function editUrl(path: string): string {
  return `/edit/${encodeContentPath(path)}`;
}

export function isEditPath(pathname: string): boolean {
  return pathname.startsWith('/edit/');
}

export function searchUrl(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

export function historyUrl(path: string): string {
  return `/history/${encodeContentPath(path)}`;
}

export function isDirectoryPath(path: string): boolean {
  return path === '' || path.endsWith('/');
}

export function trimTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function recentUrl(): string {
  return '/recent';
}
