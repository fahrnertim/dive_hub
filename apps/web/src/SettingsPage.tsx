import { useTranslation } from 'react-i18next';
import type { Me } from './api.ts';
import { DisplaySettings, SecuritySettings } from './AccountPage.tsx';
import { AdminSettings } from './AdminPage.tsx';
import { AiAccess } from './AiAccess.tsx';
import { Connections } from './Connections.tsx';
import { Devices } from './Devices.tsx';
import { useWide } from './lib/narrow.ts';
import { usePageTitle } from './lib/page.ts';
import { SETTINGS_SECTIONS, settingsHref, type SettingsSection } from './lib/settings.ts';
import { Icon, Notice, PageHeader } from './ui/index.ts';

/**
 * Settings (UI overhaul, "The shell"): one area with a view per section, the section's name its h1. From 64rem the
 * sections are a list beside the view, and "#/settings" alone opens Display; below that "#/settings" is the list, and a
 * section has its way back to it. Administration is listed for admins only; its address tells anyone else so.
 * `params`: the address's query ("connection": the Connection whose settings the Connections section goes to).
 */
export function SettingsPage({ section, me, params }: { section: SettingsSection | null; me: Me; params: URLSearchParams }) {
  const { t } = useTranslation();
  const wide = useWide();
  const admin = me.user.role === 'admin';
  const shown = section ?? (wide ? 'display' : null);
  const name = (s: SettingsSection) => t(`settings.section.${s}`);
  usePageTitle(shown ? name(shown) : t('settings.title'));

  const list = (
    <nav className={wide ? 'settings-nav' : 'settings-nav settings-rows'} aria-label={t('settings.title')}>
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
  return wide ? <div className="settings">{list}{view}</div> : view;
}

function SectionView({ section, admin, params }: { section: SettingsSection; admin: boolean; params: URLSearchParams }) {
  const { t } = useTranslation();
  switch (section) {
    case 'display': return <DisplaySettings />;
    case 'security': return <SecuritySettings />;
    case 'connections': return <Connections focus={params.get('connection') ?? undefined} />;
    case 'ai-access': return <AiAccess />;
    case 'devices': return <Devices />;
    case 'admin': return admin ? <AdminSettings /> : <Notice tone="danger">{t('errors.admins_only')}</Notice>;
  }
}
