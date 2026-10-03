import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AcceptInvitation, ResetPassword, Setup, SignIn, SignOutButton } from './Account.tsx';
import { meQuery, setupQuery, type Me } from './api.ts';
import { DiveList } from './DiveList.tsx';
import { pickLanguage } from './i18n/index.ts';
import { ImportPanel } from './ImportPanel.tsx';
import { useErrorText } from './lib/display.ts';
import { BrandMark, ErrorBoundary, Muted, Notice } from './ui/index.ts';

// Pages most visits don't need load on demand: the chart library, account settings, admin.
const DiveDetail = lazy(() => import('./DiveDetail.tsx').then((m) => ({ default: m.DiveDetail })));
const AccountPage = lazy(() => import('./Account.tsx').then((m) => ({ default: m.AccountPage })));
const Admin = lazy(() => import('./Admin.tsx').then((m) => ({ default: m.Admin })));

/** Minimal hash routing: "#/" (logbook), "#/dives/<id>", "#/account", "#/admin", "#/setup", "#/invite/<token>", "#/reset/<token>". */
function useRoute(): string {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = () => setRoute(location.hash.slice(1) || '/');
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
  const current = (active: boolean) => (active ? { 'aria-current': 'page' as const } : {});
  return (
    <>
      <nav className="app-nav" aria-label={t('nav.main')}>
        <a href="#/" {...current(route === '/' || route.startsWith('/dives/'))}>{t('nav.logbook')}</a>
        {me.user.role === 'admin' && <a href="#/admin" {...current(route === '/admin')}>{t('nav.admin')}</a>}
      </nav>
      <div className="user-menu">
        <a href="#/account" {...current(route === '/account')}>{me.user.name}</a>
        <SignOutButton />
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
  const diveId = /^\/dives\/([\w-]+)$/.exec(route)?.[1];
  if (diveId) return <DiveDetail id={diveId} />;
  if (route === '/account') return <AccountPage />;
  if (route === '/admin') return me.user.role === 'admin' ? <Admin /> : <Notice tone="danger">{t('errors.admins_only')}</Notice>;
  return (
    <>
      <ImportPanel />
      <DiveList />
    </>
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
