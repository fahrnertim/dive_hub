import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AcceptInvitation, ResetPassword, Setup, SignIn, useSignOut } from './Account.tsx';
import { divesQuery, meQuery, setupQuery, type LogbookParams, type Me } from './api.ts';
import { DiveList } from './DiveList.tsx';
import { logbookParams } from './lib/logbook.ts';
import { pickLanguage } from './i18n/index.ts';
import { Decisions } from './Decisions.tsx';
import { ImportFilesButton, ImportPanel, ImportProvider, RecentImports } from './ImportPanel.tsx';
import { useErrorText } from './lib/display.ts';
import { mayLeave } from './lib/leave-guard.ts';
import { useFocusOnNavigate } from './lib/page.ts';
import { ActionMenu, BrandMark, ErrorBoundary, Muted, Notice } from './ui/index.ts';

// Pages most visits don't need load on demand: the chart library, account settings, admin.
const DiveDetail = lazy(() => import('./DiveDetail.tsx').then((m) => ({ default: m.DiveDetail })));
const AccountPage = lazy(() => import('./AccountPage.tsx').then((m) => ({ default: m.AccountPage })));
const Admin = lazy(() => import('./Admin.tsx').then((m) => ({ default: m.Admin })));
const DiversPage = lazy(() => import('./DiversPage.tsx').then((m) => ({ default: m.DiversPage })));

/**
 * Minimal hash routing: "#/" (logbook, "#/?diver=<id>" for one Diver), "#/dives/<id>" ("?recording=<id>"), "#/divers",
 * "#/account", "#/admin", "#/setup", "#/invite/<token>", "#/reset/<token>".
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

export function App() {
  const { t } = useTranslation();
  const route = useRoute();
  const me = useQuery(meQuery());
  useLanguage(me.data);
  useFocusOnNavigate(route);

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('nav.skipToContent')}
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <a href="#/" className="brand"><BrandMark />{t('common.appName')}</a>
          {me.data && <Navigation route={route} me={me.data} />}
        </div>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        <ErrorBoundary key={route} fallback={<Notice tone="danger">{t('errors.unknown')}</Notice>}>
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
  const current = (active: boolean) => (active ? { 'aria-current': 'page' as const } : {});
  return (
    <>
      <nav className="app-nav" aria-label={t('nav.main')}>
        <a href="#/" {...current(route === '/' || route.startsWith('/?') || route.startsWith('/dives/'))}>{t('nav.logbook')}</a>
        <a href="#/divers" {...current(route === '/divers')}>{t('nav.divers')}</a>
        {me.user.role === 'admin' && <a href="#/admin" {...current(route === '/admin')}>{t('nav.admin')}</a>}
      </nav>
      {/* The account is a labelled menu, not a bare name link (UI review C6). */}
      <div className="user-menu">
        <ActionMenu
          className="user-menu-button"
          label={<>{me.user.name}<span className="visually-hidden">{t('nav.accountMenu')}</span></>}
          actions={[
            { id: 'account', label: t('nav.account'), href: '#/account' },
            { id: 'sign-out', label: t('common.signOut'), onAction: () => void signOut() },
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
  if (diveId) return <DiveDetail key={diveId} id={diveId} recordingId={params.get('recording') ?? undefined} />;
  if (route === '/account') return <AccountPage />;
  if (route === '/divers') return <DiversPage />;
  if (route === '/admin') {
    return me.user.role === 'admin' ? <Admin /> : <><h1>{t('nav.admin')}</h1><Notice tone="danger">{t('errors.admins_only')}</Notice></>;
  }
  return <Logbook params={logbookParams(params)} />;
}

/**
 * The logbook page. On the first run the Import is the main action and comes first; once there are
 * dives, the logbook comes first and importing is a button, or dropping files on the page (UI review B5).
 */
function Logbook({ params }: { params: LogbookParams }) {
  const all = useQuery(divesQuery());
  const returning = (all.data?.total ?? 0) > 0;
  return (
    <ImportProvider>
      <Decisions />
      {returning ? (
        <>
          <RecentImports />
          <DiveList params={params} importAction={<ImportFilesButton />} />
        </>
      ) : (
        <>
          {all.data && <ImportPanel />}
          <DiveList params={params} />
        </>
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
