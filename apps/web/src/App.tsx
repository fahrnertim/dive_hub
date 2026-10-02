import { useEffect, useState } from 'react';
import { DiveDetail } from './DiveDetail.tsx';
import { DiveList } from './DiveList.tsx';
import { ImportPanel } from './ImportPanel.tsx';

/** Minimal hash routing: "#/" (logbook) and "#/dives/<id>". */
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
  const diveId = /^\/dives\/([\w-]+)$/.exec(route)?.[1];

  return (
    <div className="page">
      <header className="header">
        <a href="#/" className="brand">Dive Hub</a>
        <span className="hint">Development mode: no sign-in yet</span>
      </header>
      <main>
        {diveId ? (
          <DiveDetail id={diveId} />
        ) : (
          <>
            <ImportPanel />
            <DiveList />
          </>
        )}
      </main>
    </div>
  );
}
