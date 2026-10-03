import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AcceptInvitation, AccountPage, ResetPassword, Setup, SignIn, SignOutButton } from './Account.tsx';
import { Admin } from './Admin.tsx';
import { meQuery, setupQuery, type Me } from './api.ts';
import { DiveDetail } from './DiveDetail.tsx';
import { DiveList } from './DiveList.tsx';
import { ImportPanel } from './ImportPanel.tsx';

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

export function App() {
  const route = useRoute();
  const me = useQuery(meQuery());

  return (
    <div className="page">
      <header className="header">
        <a href="#/" className="brand">Dive Hub</a>
        {me.data && <UserMenu me={me.data} />}
      </header>
      <main>
        <Main route={route} me={me} />
      </main>
    </div>
  );
}

function Main({ route, me }: { route: string; me: ReturnType<typeof useQuery<Me | null>> }) {
  if (me.isPending) return <p className="hint">Loading…</p>;
  if (me.error) return <p className="error">{me.error.message}</p>;
  return me.data ? <SignedIn route={route} me={me.data} /> : <SignedOut route={route} />;
}

function UserMenu({ me }: { me: Me }) {
  return (
    <nav className="user-menu">
      {me.user.role === 'admin' && <a href="#/admin">Admin</a>}
      <a href="#/account">{me.user.name}</a>
      <SignOutButton />
    </nav>
  );
}

function SignedIn({ route, me }: { route: string; me: Me }) {
  const diveId = /^\/dives\/([\w-]+)$/.exec(route)?.[1];
  if (diveId) return <DiveDetail id={diveId} />;
  if (route === '/account') return <AccountPage />;
  if (route === '/admin') return me.user.role === 'admin' ? <Admin /> : <p className="error">Admins only.</p>;
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
