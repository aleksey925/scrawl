export function encodeContentPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
