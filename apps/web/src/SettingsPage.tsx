import { lazy, Suspense, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me } from './api.ts';
import { DisplaySettings, SecuritySettings } from './AccountSettings.tsx';
import { AiAccess } from './AiAccess.tsx';
import { Connections } from './Connections.tsx';
import { Devices } from './Devices.tsx';
import { useRoomy, useWide } from './lib/narrow.ts';
import { usePageTitle } from './lib/page.ts';
import { isSettingsSection, SETTINGS_SECTIONS, settingsHref, type SettingsSection } from './lib/settings.ts';
import { Icon, Notice, PageHeader, RowsSkeleton } from './ui/index.ts';

// Administration loads on demand: most people never open it (it was a chunk of its own as a page).
const AdminSettings = lazy(() => import('./AdminSettings.tsx').then((m) => ({ default: m.AdminSettings })));

/**
 * Settings (UI overhaul, "The shell"): one area with a view per section, the section's name its h1. From 64rem
 * "#/settings" alone opens Display, and the sections are a row of tabs above the view; from 90rem, with room beside the
 * sidebar, they are a list beside it. Below 64rem "#/settings" is the list, and a section has its way back to it. An
 * address with no such section is replaced by what "#/settings" shows. Administration is listed for admins only; its
 * address tells anyone else so.
 * `section`: the address's part after "#/settings/". `params`: the address's query ("connection": the Connection whose
 * settings the Connections section goes to).
 */
export function SettingsPage({ section: asked, me, params }: { section: string | undefined; me: Me; params: URLSearchParams }) {
  const { t } = useTranslation();
  const wide = useWide();
  const roomy = useRoomy();
  const admin = me.user.role === 'admin';
  const unknown = asked !== undefined && !isSettingsSection(asked);
  const section = isSettingsSection(asked) ? asked : null;
  const shown = section ?? (wide ? 'display' : null);
  const name = (s: SettingsSection) => t(`settings.section.${s}`);
  usePageTitle(shown ? name(shown) : t('settings.title'));
  useLayoutEffect(() => {
    if (unknown) location.replace(wide ? settingsHref('display') : '#/settings');
  }, [unknown, wide]);
  if (unknown) return null;

  const layout = !wide ? 'settings-rows' : roomy ? 'settings-list' : 'settings-tabs';
  const list = (
    <nav className={`settings-nav ${layout}`} aria-label={t('settings.title')}>
      <ul>
        {SETTINGS_SECTIONS.filter((s) => s !== 'admin' || admin).map((s) => (
          <li key={s}>
            <a href={settingsHref(s)} {...(s === shown && { 'aria-current': 'page' as const })}>
              {name(s)}{!wide && <Icon name="next" />}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
  if (!shown) return <><PageHeader title={t('settings.title')} />{list}</>;
  const view = (
    <div className="settings-view">
      <PageHeader title={name(shown)} {...(!wide && { back: { href: '#/settings', label: t('settings.title') } })} />
      <SectionView section={shown} admin={admin} params={params} />
    </div>
  );
  if (!wide) return view;
  return <div className={roomy ? 'settings-beside' : 'settings-above'}>{list}{view}</div>;
}

function SectionView({ section, admin, params }: { section: SettingsSection; admin: boolean; params: URLSearchParams }) {
  const { t } = useTranslation();
  switch (section) {
    case 'display': return <DisplaySettings />;
    case 'security': return <SecuritySettings />;
    case 'connections': return <Connections focus={params.get('connection') ?? undefined} />;
    case 'ai-access': return <AiAccess />;
    case 'devices': return <Devices />;
    case 'admin': return admin
      ? <Suspense fallback={<RowsSkeleton rows={3} />}><AdminSettings /></Suspense>
      : <Notice tone="danger">{t('errors.admins_only')}</Notice>;
  }
}
