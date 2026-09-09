import { useCallback, useEffect, useMemo, useState } from 'react';
import { Actor, api, sessionStore } from './lib/api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ResetPassword } from './pages/ResetPassword';
import { Recovery } from './pages/Recovery';

type State = 'loading' | 'signedOut' | 'signedIn';

function isAuthRoute(hash: string): boolean {
  return hash.startsWith('#/reset') || hash.startsWith('#/recovery');
}

export function App() {
  const [state, setState] = useState<State>('loading');
  const [actor, setActor] = useState<Actor | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [route, setRoute] = useState(window.location.hash);

  const refresh = useCallback(async () => {
    setState('loading');
    setBootstrapError(null);
    try {
      const me = await api.get<Actor>('/api/v1/auth/me');
      sessionStore.setActor(me);
      setActor(me);
      setState('signedIn');
    } catch (err) {
      sessionStore.setActor(null);
      setActor(null);
      setState('signedOut');
      if (err instanceof Error && err.message !== 'Authentication required') {
        setBootstrapError(err.message);
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Local sign-out even if the server call failed (session is gone anyway).
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [refresh]);

  const screen = useMemo(() => {
    if (state === 'loading') return <p className="muted">Checking session…</p>;
    if (state === 'signedIn') {
      return <Dashboard actor={actor as Actor} onSignOut={() => void signOut()} />;
    }
    if (isAuthRoute(route)) {
      if (route.startsWith('#/reset')) return <ResetPassword />;
      return <Recovery />;
    }
    return <Login bootstrapError={bootstrapError} onSignedIn={() => void refresh()} />;
  }, [state, actor, route, bootstrapError, signOut, refresh]);

  return <>{screen}</>;
}
