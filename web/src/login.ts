// GET /login is the server's own form, the one screen that works without
// javascript, and it is global: it answers at the root and not inside a
// project. So it is reached by a full page load and never by a router
// navigation, which would land on /p/<project>/login and send the reader back
// to a path with no project in it.
//
// The "from" is read off window.location for the same reason: the router's
// pathname has the project's basename stripped out of it.
export function loginUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `/login?from=${encodeURIComponent(here)}`;
}

export function goToLogin(): void {
  window.location.assign(loginUrl());
}
