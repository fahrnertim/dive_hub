import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AcceptInvitation, ResetPassword, Setup, SignIn, useSignOut } from './SignedOut.tsx';
import { api, divesQuery, meQuery, setupQuery, type Me } from './api.ts';
import { DiveList, LogbookHeader } from './DiveList.tsx';
import { listOfDiveAddress, logbookParams, type LogbookParams } from './lib/logbook.ts';
import { sitesParams } from './lib/sites-list.ts';
import { toolsParams } from './lib/tools.ts';
import { pickLanguage } from './i18n/languages.ts';
import { DeletedNotices } from './DeletedDives.tsx';
import { ImportFilesButton, ImportPanel, ImportProvider, RecentImports } from './ImportPanel.tsx';
import { PushRunStrip, RunMark } from './PushRun.tsx';
import { ReviewLinks, ReviewStrip } from './ReviewStrip.tsx';
import { useErrorText } from './lib/display.ts';
import { mayLeave } from './lib/leave-guard.ts';
import { navSection, type NavSection } from './lib/nav.ts';
import { useFocusOnNavigate, useTypingMark } from './lib/page.ts';
import { accountHref, accountTab } from './lib/account-tabs.ts';
import { reviewTab, useWaiting } from './lib/review.ts';
import { ActionMenu, BrandMark, ErrorBoundary, Icon, Muted, Notice, PageHeader } from './ui/index.ts';

// Pages most visits don't need load on demand: the chart library, account settings, admin.
const DivePage = lazy(() => import('./DivePage.tsx').then((m) => ({ default: m.DivePage })));
const AccountPage = lazy(() => import('./AccountPage.tsx').then((m) => ({ default: m.AccountPage })));
const AdminPage = lazy(() => import('./AdminPage.tsx').then((m) => ({ default: m.AdminPage })));
const DiversPage = lazy(() => import('./DiversPage.tsx').then((m) => ({ default: m.DiversPage })));
const SitesPage = lazy(() => import('./SitesPage.tsx').then((m) => ({ default: m.SitesPage })));
const SitePage = lazy(() => import('./SitesPage.tsx').then((m) => ({ default: m.SitePage })));
const CentresPage = lazy(() => import('./CentresPage.tsx').then((m) => ({ default: m.CentresPage })));
const CentrePage = lazy(() => import('./CentresPage.tsx').then((m) => ({ default: m.CentrePage })));
const ReviewPage = lazy(() => import('./ReviewPage.tsx').then((m) => ({ default: m.ReviewPage })));
const ToolsPage = lazy(() => import('./ToolsPage.tsx').then((m) => ({ default: m.ToolsPage })));
const SiteImportPage = lazy(() => import('./SiteImportPage.tsx').then((m) => ({ default: m.SiteImportPage })));

/**
 * Minimal hash routing: "#/" (logbook, "#/?diver=<id>" for one Diver, "#/?site=<id>" for one Dive site),
 * "#/dives/<id>" ("?recording=<id>"), "#/review" ("?tab=imports|decided|deleted"), "#/divers" ("?certifications=own|<diver id>": that Diver's certifications open), "#/sites" ("?q=…&country=…&mine=1&sort=…&order=…&page=…"), "#/sites/<id>", "#/centres", "#/centres/<id>", "#/tools" ("?o2=32&depth=30&…"), "#/tools/plan" ("?mix=32&lv=20x20&dv=…"), "#/tools/lead" ("?lw=salt&suit=wetsuit&mm=5&cyl=12~steel"), "#/account" ("?tab=connections|ai"), "#/admin", "#/admin/site-imports", "#/setup", "#/invite/<token>", "#/reset/<token>".
 */
function useRoute(): string {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = (event: HashChangeEvent) => {
      // A form with unsaved changes may keep the User here; then the address goes back, too.
      if (!mayLeave()) {
        history.replaceState(null, '', new URL(event.oldURL).hash || '#/');
        return;
      }
      setRoute(location.hash.slice(1) || '/');
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** The UI language follows the User's preference, else the browser (ADR 0014). */
function useLanguage(me: Me | null | undefined) {
  const { i18n } = useTranslation();
  const wanted = pickLanguage(me?.preferences.language, navigator.languages);
  useEffect(() => {
    if (i18n.language !== wanted) void i18n.changeLanguage(wanted);
  }, [i18n, wanted]);
}

/**
 * Opening Dive Hub asks for the fetch of every Connection whose schedule is on and whose last fetch is over an hour old
 * (ADR 0056): once per start, after sign-in, not on every page or render. The server queues; nothing is waited for, and
 * a failure is not the User's concern (the schedule tries again).
 */
function useFetchOnOpening(signedIn: boolean) {
  const asked = useRef(false);
  useEffect(() => {
    if (!signedIn || asked.current) return;
    asked.current = true;
    void api.POST('/api/connections/fetch-due').catch(() => undefined);
  }, [signedIn]);
}

export function App() {
  const { t } = useTranslation();
  const route = useRoute();
  const me = useQuery(meQuery());
  useLanguage(me.data);
  useFetchOnOpening(!!me.data);
  useFocusOnNavigate(route);
  useTypingMark();

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('nav.skipToContent')}
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <a href="#/" className="brand" translate="no"><BrandMark />{t('common.appName')}</a>
          {me.data && <Navigation route={route} me={me.data} />}
        </div>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        {/* Keyed by the page, not its query: a search or filter in the address must not rebuild the page (focus, table). */}
        <ErrorBoundary key={route.split('?')[0]} fallback={<Notice tone="danger">{t('errors.unknown')}</Notice>}>
          <Suspense fallback={<Muted>{t('common.loading')}</Muted>}>
            <Main route={route} me={me} />
          </Suspense>
        </ErrorBoundary>
      </main>
    </>
  );
}

function Navigation({ route, me }: { route: string; me: Me }) {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const section = navSection(route);
  const current = (tab: NavSection) => (tab === section ? { 'aria-current': 'page' as const } : {});
  // What waits for a decision is counted beside the logbook, visible from every page (UI redesign 4.3).
  const { total: waiting } = useWaiting();
  return (
    <>
      <nav className="app-nav" aria-label={t('nav.main')}>
        <a href="#/" {...current('logbook')}>
          <Icon name="logbook" />{t('nav.logbook')}
          <RunMark />
          {waiting > 0 && <span className="count"><span aria-hidden="true">{waiting}</span><span className="visually-hidden">{t('nav.toDecide', { count: waiting })}</span></span>}
        </a>
        <a href="#/divers" {...current('divers')}><Icon name="divers" />{t('nav.divers')}</a>
        <a href="#/sites" {...current('sites')}><Icon name="site" />{t('nav.sites')}</a>
        <a href="#/centres" {...current('centres')}><Icon name="centre" />{t('nav.centres')}</a>
        <a href="#/tools" {...current('tools')}><Icon name="tools" />{t('nav.tools')}</a>
      </nav>
      {/* The account is a labelled menu, not a bare name link (UI review C6). */}
      <div className="user-menu">
        <ActionMenu
          className="user-menu-button"
          icon="account"
          label={<>{me.user.name}<span className="visually-hidden">{t('nav.accountMenu')}</span></>}
          actions={[
            { id: 'account', label: t('nav.account'), href: accountHref('account'), icon: 'user' },
            // Where a Provider is connected is found here, not by knowing it is a part of the account page (UI review C10).
            { id: 'connections', label: t('nav.connections'), href: accountHref('connections'), icon: 'link' },
            // The own Diver's cards are a section of the Divers page; this is only a link to it (ADR 0050).
            { id: 'certifications', label: t('nav.myCertifications'), href: '#/divers?certifications=own', icon: 'certification' },
            // Rare and for one role: not in the bar (UI redesign 5.1).
            ...(me.user.role === 'admin' ? [{ id: 'admin', label: t('nav.administration'), href: '#/admin', icon: 'admin' as const }] : []),
            { id: 'sign-out', label: t('common.signOut'), onAction: () => void signOut(), icon: 'signOut' },
          ]}
        />
      </div>
    </>
  );
}

function Main({ route, me }: { route: string; me: UseQueryResult<Me | null> }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  if (me.isPending) return <Muted>{t('common.loading')}</Muted>;
  if (me.error) return <Notice tone="danger">{errorText(me.error)}</Notice>;
  return me.data ? <SignedIn route={route} me={me.data} /> : <SignedOut route={route} />;
}

function SignedIn({ route, me }: { route: string; me: Me }) {
  const { t } = useTranslation();
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  const diveId = /^\/dives\/([\w-]+)$/.exec(path!)?.[1];
  if (diveId) return <DivePage key={diveId} id={diveId} recordingId={params.get('recording') ?? undefined} list={listOfDiveAddress(params)} />;
  if (path === '/account') return <AccountPage tab={accountTab(params)} connection={params.get('connection') ?? undefined} />;
  if (path === '/divers') return <DiversPage open={params.get('certifications') ?? undefined} />;
  if (path === '/review') return <ReviewPage tab={reviewTab(params)} />;
  if (path === '/sites') return <SitesPage params={sitesParams(params)} />;
  const siteId = /^\/sites\/([\w-]+)$/.exec(path!)?.[1];
  if (siteId) return <SitePage key={siteId} id={siteId} />;
  if (path === '/tools' || path === '/tools/plan' || path === '/tools/lead') return <ToolsPage params={toolsParams(params, path === '/tools' ? 'gas' : path === '/tools/plan' ? 'plan' : 'lead')} />;
  if (path === '/centres') return <CentresPage />;
  const centreId = /^\/centres\/([\w-]+)$/.exec(path!)?.[1];
  if (centreId) return <CentrePage key={centreId} id={centreId} />;
  if (route === '/admin' || route === '/admin/site-imports') {
    if (me.user.role !== 'admin') return <><PageHeader title={t('nav.admin')} /><Notice tone="danger">{t('errors.admins_only')}</Notice></>;
    return route === '/admin' ? <AdminPage /> : <SiteImportPage />;
  }
  return <Logbook params={logbookParams(params)} />;
}

/**
 * The logbook page. On the first run the Import is the main action and comes first; once there are
 * dives, the logbook comes first and importing is a button, or dropping files on the page (UI review B5).
 * The page head comes first in both, then one line for what waits for a decision (UI redesign 4.1), which is decided
 * on the Review page; the first run's Import panel stays until the first dives exist (4.7).
 */
function Logbook({ params }: { params: LogbookParams }) {
  const all = useQuery(divesQuery());
  const returning = (all.data?.total ?? 0) > 0;
  return (
    <ImportProvider>
      <LogbookHeader importAction={returning && <ImportFilesButton />} />
      <ReviewLinks />
      <DeletedNotices />
      <ReviewStrip />
      <PushRunStrip />
      {returning ? (
        <>
          <DiveList params={params} />
          <RecentImports />
        </>
      ) : (
        // The first run is one panel: the import is the only way in, so there is no empty list under it (C23).
        all.data && <ImportPanel />
      )}
    </ImportProvider>
  );
}

function SignedOut({ route }: { route: string }) {
  const setup = useQuery(setupQuery());
  const inviteToken = /^\/invite\/([\w-]+)$/.exec(route)?.[1];
  if (inviteToken) return <AcceptInvitation token={inviteToken} />;
  const resetToken = /^\/reset\/([\w-]+)$/.exec(route)?.[1];
  if (resetToken) return <ResetPassword token={resetToken} />;
  if (route === '/setup' || setup.data?.needed) return <Setup />;
  return <SignIn />;
}
