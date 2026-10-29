/** The tabs of the main navigation. */
export type NavSection = 'logbook' | 'divers' | 'sites' | 'centres' | 'tools';

/** The tab an address ("/sites/<id>?…") belongs to, by its first path segment; the account and admin pages have none. */
export function navSection(route: string): NavSection | null {
  const first = route.split('?')[0]!.split('/')[1] ?? '';
  if (first === '' || first === 'dives' || first === 'review') return 'logbook';
  return first === 'divers' || first === 'sites' || first === 'centres' || first === 'tools' ? first : null;
}
