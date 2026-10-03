import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, invitationsQuery, keys, unwrap, usersQuery } from './api.ts';
import { formatLocalDateTime } from './format.ts';

const date = (iso: string) => formatLocalDateTime(iso, null);

/** Admins invite people (copy the link, there's no mail yet) and see who has an account (ADR 0012). */
export function Admin() {
  return (
    <>
      <Invite />
      <Invitations />
      <Users />
    </>
  );
}

function Invite() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const invite = useMutation({
    mutationFn: async (body: { email: string; role: 'user' | 'admin' }) =>
      unwrap(await api.POST('/api/invitations', { body })),
    onSuccess: () => {
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: keys.invitations });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    invite.mutate({ email: String(form.get('email')), role: form.get('admin') ? 'admin' : 'user' });
    event.currentTarget.reset();
  };

  return (
    <section className="card">
      <h2>Invite someone</h2>
      <form className="form inline" onSubmit={submit}>
        <label>E-mail<input name="email" type="email" required autoComplete="off" /></label>
        <label className="check"><input name="admin" type="checkbox" /> Admin</label>
        <button type="submit" disabled={invite.isPending}>Create invitation link</button>
      </form>
      {invite.error && <p className="error">{invite.error.message}</p>}
      {invite.data && (
        <div className="invite-link">
          <p>Send this link to <strong>{invite.data.email}</strong>. It works once, until {date(invite.data.expiresAt)}, and is shown only now.</p>
          <div className="copy">
            <input readOnly value={invite.data.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(invite.data.url); setCopied(true); }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Invitations() {
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery());
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/api/invitations/{id}', { params: { path: { id } } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  });

  if (!invitations.data?.length) return null;
  return (
    <section className="card">
      <h2>Invitations</h2>
      {revoke.error && <p className="error">{revoke.error.message}</p>}
      <table className="table">
        <thead><tr><th>E-mail</th><th>Role</th><th>Status</th><th>Expires</th><th /></tr></thead>
        <tbody>
          {invitations.data.map((i) => (
            <tr key={i.id}>
              <td>{i.email}</td>
              <td>{i.role}</td>
              <td className={`status ${i.status}`}>{i.status}</td>
              <td>{i.status === 'pending' ? date(i.expiresAt) : '–'}</td>
              <td>
                {i.status === 'pending' && (
                  <button type="button" className="link" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>Revoke</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Users() {
  const users = useQuery(usersQuery());
  return (
    <section className="card">
      <h2>Users</h2>
      {users.error && <p className="error">{users.error.message}</p>}
      {users.data && (
        <table className="table">
          <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Since</th></tr></thead>
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{date(u.createdAt)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
