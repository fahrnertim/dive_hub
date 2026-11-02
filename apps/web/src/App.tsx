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
import { useFocusOnNavigate, useTypingMark } from './lib/page.ts';
import { reviewTab } from './lib/review.ts';
import { legacyRedirect } from './lib/settings.ts';
import { ErrorBoundary, Notice, PageHeader, RowsSkeleton } from './ui/index.ts';
import { PlainShell, Shell } from './ui/Shell.tsx';

// Pages most visits don't need load on demand: the chart library, Settings.
const DivePage = lazy(() => import('./DivePage.tsx').then((m) => ({ default: m.DivePage })));
const SettingsPage = lazy(() => import('./SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })));
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
 * "#/dives/<id>" ("?recording=<id>"), "#/review" ("?tab=imports|decided|deleted"), "#/divers" ("?certifications=own|<diver id>": that Diver's certifications open), "#/sites" ("?q=…&country=…&mine=1&sort=…&order=…&page=…"), "#/sites/<id>", "#/centres", "#/centres/<id>", "#/tools" ("?o2=32&depth=30&…"), "#/tools/plan" ("?mix=32&lv=20x20&dv=…"), "#/tools/lead" ("?lw=salt&suit=wetsuit&mm=5&cyl=12~steel"), "#/settings" ("#/settings/<section>", "#/settings/connections?connection=<id>"), "#/settings/admin/site-imports", "#/setup", "#/invite/<token>", "#/reset/<token>".
 * The addresses from before Settings ("#/account…", "#/admin…") are replaced by their new ones before routing.
 */
function useRoute(): string {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = (event: HashChangeEvent) => {
      // A form with unsaved changes may keep the User here; then the address goes back, too.
      if (!mayLeave()) {
        history.replaceState(null, '', new URL(event.oldURL).hash || '#/');
        return;
      }
      setRoute(currentRoute());
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function currentRoute(): string {
  const route = location.hash.slice(1) || '/';
  const moved = legacyRedirect(route);
  if (!moved) return route;
  location.replace(moved);
  return moved.slice(1);
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
  const signOut = useSignOut();

  // Keyed by the page, not its query: a search or filter in the address must not rebuild the page (focus, table).
  const page = (
    <ErrorBoundary key={route.split('?')[0]} fallback={<Notice tone="danger">{t('errors.unknown')}</Notice>}>
      <Suspense fallback={<RowsSkeleton rows={3} />}>
        <Main route={route} me={me} />
      </Suspense>
    </ErrorBoundary>
  );
  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('nav.skipToContent')}
      </a>
      {me.data ? <Shell me={me.data} route={route} logbookMark={<RunMark />} onSignOut={() => void signOut()}>{page}</Shell> : <PlainShell>{page}</PlainShell>}
    </>
  );
}

function Main({ route, me }: { route: string; me: UseQueryResult<Me | null> }) {
  const errorText = useErrorText();
  if (me.isPending) return <RowsSkeleton rows={3} />;
  if (me.error) return <Notice tone="danger">{errorText(me.error)}</Notice>;
  return me.data ? <SignedIn route={route} me={me.data} /> : <SignedOut route={route} />;
}

function SignedIn({ route, me }: { route: string; me: Me }) {
  const { t } = useTranslation();
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  const diveId = /^\/dives\/([\w-]+)$/.exec(path!)?.[1];
  if (diveId) return <DivePage key={diveId} id={diveId} recordingId={params.get('recording') ?? undefined} list={listOfDiveAddress(params)} />;
  if (path === '/divers') return <DiversPage open={params.get('certifications') ?? undefined} />;
  if (path === '/review') return <ReviewPage tab={reviewTab(params)} />;
  if (path === '/sites') return <SitesPage params={sitesParams(params)} />;
  const siteId = /^\/sites\/([\w-]+)$/.exec(path!)?.[1];
  if (siteId) return <SitePage key={siteId} id={siteId} />;
  if (path === '/tools' || path === '/tools/plan' || path === '/tools/lead') return <ToolsPage params={toolsParams(params, path === '/tools' ? 'gas' : path === '/tools/plan' ? 'plan' : 'lead')} />;
  if (path === '/centres') return <CentresPage />;
  const centreId = /^\/centres\/([\w-]+)$/.exec(path!)?.[1];
  if (centreId) return <CentrePage key={centreId} id={centreId} />;
  const settings = /^\/settings(?:\/([\w-]+))?$/.exec(path!);
  if (settings) return <SettingsPage section={settings[1]} me={me} params={params} />;
  if (path === '/settings/admin/site-imports') {
    return me.user.role === 'admin' ? <SiteImportPage /> : <><PageHeader title={t('siteImport.title')} /><Notice tone="danger">{t('errors.admins_only')}</Notice></>;
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
