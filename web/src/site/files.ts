const markdown = /\.md$/i;
const folderIndex = 'index.md';
const folderPage = 'index.html';
// a folder's index.md, written beside the folder's list and not over it
const indexPage = 'index.md.html';

// fileOf is the file of a site a route of the app is written to, relative to
// the root of the site. Both sides are percent-encoded the same way, so a name
// with a space or a question mark crosses as it is. It is the mapping site.go
// writes the files by.
export function fileOf(pathname: string): string {
  if (pathname.startsWith('/raw/')) {
    return pathname.slice('/raw/'.length);
  }
  if (!pathname.startsWith('/doc/')) {
    return folderPage;
  }
  const rest = pathname.slice('/doc/'.length);
  if (rest === '' || rest.endsWith('/')) {
    return rest + folderPage;
  }
  const at = rest.lastIndexOf('/') + 1;
  if (rest.slice(at).toLowerCase() === folderIndex) {
    return rest.slice(0, at) + indexPage;
  }
  return rest.replace(markdown, '.html');
}

// isFolderRoute is a route of a folder, which a page of a site answers with its
// listing
export function isFolderRoute(route: string): boolean {
  return route === '/' || route.endsWith('/');
}
