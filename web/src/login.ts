export function loginUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `/login?from=${encodeURIComponent(here)}`;
}

export function goToLogin(): void {
  window.location.assign(loginUrl());
}
