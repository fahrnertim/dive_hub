import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, authClient, keys, unwrap } from './api.ts';

const MIN_PASSWORD_LENGTH = 15;

/** After signing in as someone (else), nothing cached for the previous User may show. */
function useSignedIn() {
  const queryClient = useQueryClient();
  return async () => {
    queryClient.clear();
    await queryClient.invalidateQueries({ queryKey: keys.me });
    history.replaceState(null, '', location.pathname); // drop tokens from the address bar
    location.hash = '/';
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
  const signedIn = useSignedIn();
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
  const signedIn = useSignedIn();
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
  const signedIn = useSignedIn();
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
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        queryClient.clear();
        queryClient.setQueryData(keys.me, null);
        location.hash = '/';
        setBusy(false);
      }}
    >
      Sign out
    </button>
  );
}
