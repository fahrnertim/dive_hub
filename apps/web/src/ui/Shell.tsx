import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me } from '../api.ts';
import { initials } from '../lib/avatar.ts';
import { navSection, type NavSection } from '../lib/nav.ts';
import { useWide } from '../lib/narrow.ts';
import { useToDecideCounts } from '../lib/review.ts';
import { Avatar } from './Avatar.tsx';
import { Icon } from './Icon.tsx';
import { BrandMark } from './Layout.tsx';
import { ActionMenu } from './Menu.tsx';

/**
 * The frame around every signed-in page (UI overhaul, "The shell"): a tinted frame with the page as a white sheet in it.
 * From 64rem the frame is a sidebar (brand, the five destinations, Settings and the user row at its foot) beside the sheet,
 * which is inset 8px; below that a top bar (brand and the user's avatar) over a full-width sheet, and the destinations in
 * a bottom bar. One `Main` navigation serves both. The user menu comes where it shows, so the order of Tab is the order on
 * screen (WCAG 2.4.3): after Settings in the sidebar, before the bottom bar in the top bar. `logbookMark` (a run going)
 * sits beside Logbook; the shared components import no page (ADR 0053), so the page-level parts come in as props.
 */
export function Shell({ me, route, children, logbookMark, onSignOut }: {
  me: Me; route: string; children: ReactNode; logbookMark?: ReactNode; onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const section = navSection(route);
  const current = (place: NavSection) => (place === section ? { 'aria-current': 'page' as const } : {});
  // What waits for a decision is counted beside the logbook, visible from every page (UI redesign 4.3).
  const { total: toDecide } = useToDecideCounts();
  const wide = useWide();
  // The account is a labelled menu, not a bare name link (UI review C6).
  const userMenu = (
    <div className="shell-user">
      <ActionMenu
        className="shell-user-button"
        label={<><Avatar letters={initials(me.user.name)} /><span className="shell-user-name">{me.user.name}</span><span className="visually-hidden">{t('nav.accountMenu')}</span></>}
        actions={[
          // Display, Connections, AI access and Administration are sections of Settings.
          { id: 'settings', label: t('nav.settings'), href: '#/settings', icon: 'settings' },
          // The own Diver's cards are a section of the Divers page; this is only a link to it (ADR 0050).
          { id: 'certifications', label: t('nav.myCertifications'), href: '#/divers?certifications=own', icon: 'certification' },
          { id: 'sign-out', label: t('common.signOut'), onAction: onSignOut, icon: 'signOut' },
        ]}
      />
    </div>
  );
  return (
    <div className="shell">
      <header className="shell-side">
        <a href="#/" className="brand" translate="no"><BrandMark />{t('common.appName')}</a>
        {!wide && userMenu}
        <nav className="shell-nav" aria-label={t('nav.main')}>
          <a href="#/" {...current('logbook')}>
            <Icon name="logbook" /><span className="shell-nav-label">{t('nav.logbook')}</span>
            {logbookMark}
            {toDecide > 0 && <span className="count"><span aria-hidden="true">{toDecide}</span><span className="visually-hidden">{t('nav.toDecide', { count: toDecide })}</span></span>}
          </a>
          <a href="#/divers" {...current('divers')}><Icon name="divers" /><span className="shell-nav-label">{t('nav.divers')}</span></a>
          <a href="#/sites" {...current('sites')}><Icon name="site" /><NavLabel full={t('nav.sites')} short={t('nav.short.sites')} /></a>
          <a href="#/centres" {...current('centres')}><Icon name="centre" /><NavLabel full={t('nav.centres')} short={t('nav.short.centres')} /></a>
          <a href="#/tools" {...current('tools')}><Icon name="tools" /><NavLabel full={t('nav.tools')} short={t('nav.short.tools')} /></a>
        </nav>
        {/* Below 64rem Settings is in the user menu: the bottom bar holds the five destinations only. */}
        <a href="#/settings" className="shell-settings" {...current('settings')}><Icon name="settings" />{t('nav.settings')}</a>
        {wide && userMenu}
      </header>
      <main id="main" className="app-main" tabIndex={-1}>{children}</main>
    </div>
  );
}

/** A destination's label, with a shorter one shown in the bottom bar of a narrow phone; the full one stays its name. */
function NavLabel({ full, short }: { full: string; short: string }) {
  return <><span className="shell-nav-label shell-nav-full">{full}</span><span className="shell-nav-label shell-nav-short" aria-hidden="true">{short}</span></>;
}

/** The frame without navigation, while nobody is signed in: the brand over the sheet. */
export function PlainShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="shell shell-plain">
      <header className="shell-side">
        <a href="#/" className="brand" translate="no"><BrandMark />{t('common.appName')}</a>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
