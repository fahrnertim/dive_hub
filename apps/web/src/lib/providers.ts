// Providers in the web client (ADR 0027): what the server says each offers (GET /api/providers), and their texts. The
// panels render from the capabilities; texts name the Provider, in its own words where it has them.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { providersQuery, type ProblemCode, type ProviderView, type RequirementView } from '../api.ts';
import type en from '../i18n/locales/en.json';

type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string];
/** A text under `provider` in en.json; a Provider may word it itself under `providers.<id>`. */
export type ProviderTextKey = Paths<(typeof en)['provider']>;
/**
 * What a Provider may word itself under `providers.<id>`: a text of `provider.*` (useProviderText), or a problem's
 * text `errors.<code>` (useProblemText in display.ts). Anything else there would never be shown.
 */
export type ProviderOverrideKey = ProviderTextKey | `errors.${ProblemCode}`;
type Overrides = (typeof en)['providers'];
/** The keys under `providers.<id>` in en.json that override nothing: `never` while every one does (test/translations.test.ts). */
export type StrayOverride = { [Id in keyof Overrides]: Exclude<Paths<Overrides[Id]>, ProviderOverrideKey> }[keyof Overrides];

/** The Providers that take dives, in the server's order. */
export const exporting = (providers: ProviderView[] | undefined) => (providers ?? []).filter((p) => p.data.dives?.export);
/**
 * Whether the Dive at a Provider has something that waits for the User: it changed since it was sent, the last
 * sending failed, or the connection needs a new sign-in. Its line on the dive page then opens by itself.
 */
export const waitsForUser = (s: {
  connection: { state: string } | null; current: { upToDate: boolean } | null; pushes: { state: string }[];
}) => !!s.connection && (s.connection.state === 'needs_sign_in' || s.pushes[0]?.state === 'failed' || (!!s.current && !s.current.upToDate));
/** The Providers a User connects to (any sign-in but none). */
export const connectable = (providers: ProviderView[] | undefined) => (providers ?? []).filter((p) => p.signIn.kind !== 'none');

export function useProviders() {
  return useQuery(providersQuery());
}

/** Texts about one Provider: `providers.<id>.<key>` where it words them itself, else `provider.<key>` with its name. */
export function useProviderText(p: Pick<ProviderView, 'id' | 'name'>) {
  const { t, i18n } = useTranslation();
  const translate = t as unknown as (key: string, options: Record<string, unknown>) => string;
  return (key: ProviderTextKey, options: Record<string, unknown> = {}): string => {
    const own = `providers.${p.id}.${key}`;
    return translate(i18n.exists(own) ? own : `provider.${key}`, { name: p.name, ...options });
  };
}

/**
 * What a User typed, as a site ID of the requirement's Source: a prefix the Source shows before it is dropped (SSI's
 * QR code says "site:3314"). Undefined when it isn't one. The forms come from the Provider (GET /api/providers).
 */
export function typedSiteId(r: Pick<RequirementView, 'pattern' | 'prefixes'>, text: string): string | undefined {
  let value = text.trim();
  const prefix = (r.prefixes ?? []).find((x) => value.toLowerCase().startsWith(x.toLowerCase()));
  if (prefix) value = value.slice(prefix.length).trim();
  return r.pattern && new RegExp(r.pattern).test(value) ? value : undefined;
}

/** "SSI", "SSI and PADI": names joined the way the UI language does. */
export function useNames() {
  const { i18n } = useTranslation();
  return (names: string[]) => new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names);
}
