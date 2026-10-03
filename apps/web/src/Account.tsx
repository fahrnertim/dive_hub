import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, authClient, keys, sessionsQuery, unwrap, type SessionView } from './api.ts';
import { formatLocalDateTime } from './format.ts';

const MIN_PASSWORD_LENGTH = 15;

/**
 * After the User changes, nothing cached for the previous one may show. resetQueries drops all
 * cached data and refetches what's on screen (so `me` picks up the new session); clear() would
 * detach the mounted queries and leave the page as it was.
 */
function useUserChanged() {
  const queryClient = useQueryClient();
  return async () => {
    history.replaceState(null, '', location.pathname); // drop tokens from the address bar
    location.hash = '/';
    await queryClient.resetQueries();
  };
}

const formValues = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
};

function PasswordField({ label = 'Password' }: { label?: string }) {
  return (
    <label>
      {label}
      <input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={128} />
      <span className="hint">At least {MIN_PASSWORD_LENGTH} characters. A few words in a row work well.</span>
    </label>
  );
}

export function SignIn() {
  const signedIn = useUserChanged();
  const signIn = useMutation({
    mutationFn: async ({ email, password }: Record<string, string>) => {
      const { error } = await authClient.signIn.email({ email: email!, password: password! });
      if (error) throw new Error(error.status === 429 ? 'Too many attempts. Try again in a few minutes.' : 'Wrong e-mail or password.');
    },
    onSuccess: signedIn,
  });

  return (
    <section className="card narrow">
      <h2>Sign in</h2>
      <form className="form" onSubmit={(e) => signIn.mutate(formValues(e))}>
        <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {signIn.error && <p className="error">{signIn.error.message}</p>}
        <button type="submit" disabled={signIn.isPending}>Sign in</button>
      </form>
      <p className="hint">No account? Ask the admin of this Dive Hub for an invitation.</p>
    </section>
  );
}

/** First start: whoever has the setup token from the server log creates the first admin. */
export function Setup() {
  const signedIn = useUserChanged();
  const setup = useMutation({
    mutationFn: async ({ token, name, email, password }: Record<string, string>) =>
      unwrap(await api.POST('/api/setup', { body: { token: token!.trim(), name: name!, email: email!, password: password! } })),
    onSuccess: signedIn,
  });

  return (
    <section className="card narrow">
      <h2>Set up Dive Hub</h2>
      <p>Create the first admin account. The setup token is in the server log (for example <code>docker compose logs app</code>).</p>
      <form className="form" onSubmit={(e) => setup.mutate(formValues(e))}>
        <label>Setup token<input name="token" required autoComplete="off" spellCheck={false} /></label>
        <label>Your name<input name="name" required maxLength={100} autoComplete="name" /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="username" /></label>
        <PasswordField />
        {setup.error && <p className="error">{setup.error.message}</p>}
        <button type="submit" disabled={setup.isPending}>Create admin</button>
      </form>
    </section>
  );
}

export function AcceptInvitation({ token }: { token: string }) {
  const signedIn = useUserChanged();
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: async () => unwrap(await api.POST('/api/invitations/lookup', { body: { token } })),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: async ({ name, password }: Record<string, string>) =>
      unwrap(await api.POST('/api/invitations/accept', { body: { token, name: name!, password: password! } })),
    onSuccess: signedIn,
  });

  if (invitation.isPending) return <p className="hint">Checking invitation…</p>;
  if (invitation.error) {
    return (
      <section className="card narrow">
        <h2>Invitation</h2>
        <p className="error">{invitation.error.message}</p>
        <p className="hint">Ask the admin for a new link.</p>
      </section>
    );
  }
  return (
    <section className="card narrow">
      <h2>Join Dive Hub</h2>
      <p>You were invited as <strong>{invitation.data.email}</strong>. Choose your name and a password.</p>
      <form className="form" onSubmit={(e) => accept.mutate(formValues(e))}>
        <input type="email" name="email" value={invitation.data.email} autoComplete="username" readOnly hidden />
        <label>Your name<input name="name" required maxLength={100} autoComplete="name" /></label>
        <PasswordField />
        {accept.error && <p className="error">{accept.error.message}</p>}
        <button type="submit" disabled={accept.isPending}>Create account</button>
      </form>
    </section>
  );
}

export function SignOutButton() {
  const userChanged = useUserChanged();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        await userChanged(); // `me` refetches as nobody, which shows the sign-in page
      }}
    >
      Sign out
    </button>
  );
}

/** Opened from a password reset link an admin passed on (ADR 0013). */
export function ResetPassword({ token }: { token: string }) {
  const signedIn = useUserChanged();
  const link = useQuery({
    queryKey: ['password-reset', token],
    queryFn: async () => unwrap(await api.POST('/api/password-resets/lookup', { body: { token } })),
    retry: false,
  });
  const reset = useMutation({
    mutationFn: async ({ password }: Record<string, string>) =>
      unwrap(await api.POST('/api/password-resets/complete', { body: { token, password: password! } })),
    onSuccess: signedIn,
  });

  if (link.isPending) return <p className="hint">Checking link…</p>;
  if (link.error) {
    return (
      <section className="card narrow">
        <h2>Reset password</h2>
        <p className="error">{link.error.message}</p>
        <p className="hint">Ask the admin for a new link.</p>
      </section>
    );
  }
  return (
    <section className="card narrow">
      <h2>Reset password</h2>
      <p>Choose a new password for <strong>{link.data.email}</strong>. You'll be signed out everywhere else.</p>
      <form className="form" onSubmit={(e) => reset.mutate(formValues(e))}>
        <input type="email" name="email" value={link.data.email} autoComplete="username" readOnly hidden />
        <PasswordField label="New password" />
        {reset.error && <p className="error">{reset.error.message}</p>}
        <button type="submit" disabled={reset.isPending}>Set password</button>
      </form>
    </section>
  );
}

/** The signed-in User's own account: password and where they're signed in. */
export function AccountPage() {
  return (
    <>
      <ChangePassword />
      <Sessions />
    </>
  );
}

function ChangePassword() {
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: async ({ currentPassword, password }: Record<string, string>) => {
      const { error } = await authClient.changePassword({
        currentPassword: currentPassword!, newPassword: password!, revokeOtherSessions: true,
      });
      if (error) throw new Error(error.status === 400 && error.code === 'INVALID_PASSWORD' ? 'The current password is wrong.' : (error.message ?? 'Could not change the password.'));
    },
    onSuccess: () => {
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
    },
  });

  return (
    <section className="card">
      <h2>Change password</h2>
      <form
        className="form narrow-form"
        onSubmit={(e) => {
          const values = formValues(e);
          const form = e.currentTarget;
          setDone(false);
          change.mutate(values, { onSuccess: () => form.reset() });
        }}
      >
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <PasswordField label="New password" />
        {change.error && <p className="error">{change.error.message}</p>}
        {done && <p className="ok">Password changed. Your other sessions were signed out.</p>}
        <button type="submit" disabled={change.isPending}>Change password</button>
      </form>
    </section>
  );
}

/** "Firefox on Windows" from a user agent string; good enough to recognise one's own devices. */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const os = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function Sessions() {
  const queryClient = useQueryClient();
  const userChanged = useUserChanged();
  const sessions = useQuery(sessionsQuery());
  const end = useMutation({
    mutationFn: async (s: SessionView) => {
      unwrap(await api.DELETE('/api/me/sessions/{id}', { params: { path: { id: s.id } } }));
      return s;
    },
    onSuccess: async (s) => (s.current ? userChanged() : queryClient.invalidateQueries({ queryKey: keys.sessions })),
  });
  const endOthers = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/me/sessions')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.sessions }),
  });

  return (
    <section className="card">
      <h2>Where you're signed in</h2>
      {sessions.error && <p className="error">{sessions.error.message}</p>}
      {sessions.data && (
        <table className="table">
          <thead><tr><th>Device</th><th>IP address</th><th>Signed in</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id}>
                <td>{describeAgent(s.userAgent)}{s.current && <strong> (this one)</strong>}</td>
                <td>{s.ipAddress ?? '–'}</td>
                <td>{formatLocalDateTime(s.createdAt, null)}</td>
                <td>{s.lastActiveAt ? formatLocalDateTime(s.lastActiveAt, null) : '–'}</td>
                <td>
                  <button type="button" className="link" disabled={end.isPending} onClick={() => end.mutate(s)}>Sign out</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(end.error ?? endOthers.error) && <p className="error">{(end.error ?? endOthers.error)!.message}</p>}
      {sessions.data && sessions.data.length > 1 && (
        <p><button type="button" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>Sign out everywhere else</button></p>
      )}
    </section>
  );
}
