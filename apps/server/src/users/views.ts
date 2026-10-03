// API shapes shared by the user, account and admin routes.
import { Type, type Static } from 'typebox';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/password.js';
import type { Role } from './invitations.js';

export { Problem } from '../http/problems.js';
export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
export const DateTime = Type.String({ format: 'date-time' });
export const RoleSchema = Type.Union([Type.Literal('user'), Type.Literal('admin')]);
export const Password = Type.String({
  minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH,
  description: `At least ${MIN_PASSWORD_LENGTH} characters`,
});
export const Token = Type.String({ minLength: 16, maxLength: 128 });

export const UserView = Type.Object({
  id: Type.String(), email: Type.String(), name: Type.String(), role: RoleSchema,
  disabled: Type.Boolean({ description: 'Disabled Users can\'t sign in; their data stays' }),
  createdAt: DateTime,
});

export const PreferencesView = Type.Object({
  // Null first, so the validator's type coercion never turns null into a string (see dives/routes.ts).
  language: Type.Union([Type.Null(), Type.String({ pattern: '^[a-z]{2,3}(-[A-Z]{2})?$', description: 'BCP 47 tag, e.g. "de"' })], {
    description: 'Null: follow the browser',
  }),
  units: Type.Union([Type.Null(), Type.Literal('metric'), Type.Literal('imperial')], {
    description: 'Null: follow the region of the browser',
  }),
});

/** A link shown once to the admin, who passes it on (Invitations, password reset links). */
export const LinkView = Type.Object({
  url: Type.String({ description: 'Shown only now: only a hash of its token is stored.' }),
  expiresAt: DateTime,
});

const asRole = (role: string | null | undefined): Role => (role === 'admin' ? 'admin' : 'user');

export const toUserView = (u: {
  id: string; email: string; name: string; role?: string | null | undefined; banned?: boolean | null | undefined; createdAt: Date;
}): Static<typeof UserView> => ({
  id: u.id, email: u.email, name: u.name, role: asRole(u.role), disabled: u.banned === true, createdAt: u.createdAt.toISOString(),
});
