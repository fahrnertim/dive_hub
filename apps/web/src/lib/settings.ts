/**
 * Settings is one area with a view per section, "#/settings/<section>", the section's name its h1 (UI overhaul, "The
 * shell"). Administration is a section only admins see listed.
 */
export const SETTINGS_SECTIONS = ['display', 'security', 'connections', 'ai-access', 'devices', 'admin'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return SETTINGS_SECTIONS.some((s) => s === value);
}

/** A section's address, "#/settings/<section>", with `query` ("?connection=<id>") when given. */
export function settingsHref(section: SettingsSection, query?: Record<string, string>): string {
  const search = new URLSearchParams(query).toString();
  return `#/settings/${section}${search ? `?${search}` : ''}`;
}

/** The SSI site import, an admin's page under Administration. */
export const SITE_IMPORTS_HREF = `${settingsHref('admin')}/site-imports`;

/** A Connection's settings ("#/settings/connections?connection=<id>"): the section goes to them. */
export function connectionHref(connectionId: string): string {
  return settingsHref('connections', { connection: connectionId });
}

const ACCOUNT_TABS: Record<string, SettingsSection> = { connections: 'connections', ai: 'ai-access' };

/**
 * Where an old address leads now ("#/account?tab=…" and "#/admin…", from before Settings), or null for an address that
 * stays. Old bookmarks and links may carry parameters ("#/account?tab=connections&connection=<id>"); they go along.
 */
export function legacyRedirect(route: string): string | null {
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  if (path === '/account') {
    const section = ACCOUNT_TABS[params.get('tab') ?? ''] ?? 'display';
    params.delete('tab');
    return settingsHref(section, Object.fromEntries(params));
  }
  if (path === '/admin') return settingsHref('admin', Object.fromEntries(params));
  if (path === '/admin/site-imports') return SITE_IMPORTS_HREF;
  return null;
}
