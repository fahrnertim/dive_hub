// The seam between Dive Hub and an outside service it talks to (ADR 0027): a Provider is one adapter that declares
// its capabilities (how Users sign in, what it imports or exports, with which operations, how fast it may be called)
// and does only what is its own. Connections, credentials, Pushes, locking, pacing, problem codes and the routes are
// the generic layer's (connection-service.ts, push-service.ts, routes.ts).
import type { SiteWaterType } from '../vocabulary.js';
import type { SiteSource } from '../sites/sources.js';

export type DiverSource = 'ssi' | 'padi';

/** A Provider's id, e.g. `ssi`. The registry knows which exist; a test-only adapter registers its own in tests. */
export type ProviderId = string;

/** How a User signs in at the Provider. OAuth in the User's browser is designed in ADR 0027, not built. */
export type SignIn =
  | { kind: 'none' }
  /** E-mail (or user name) and password. The User may let Dive Hub keep the password, sealed, to renew by itself. */
  | { kind: 'password'; login: 'email' | 'username' }
  /** A token the User copies from the Provider. */
  | { kind: 'token' };

export const OPERATIONS = ['create', 'update', 'delete', 'link', 'find', 'list', 'readBack'] as const;
export type Operation = (typeof OPERATIONS)[number];
export const FIND_BY = ['reference', 'time', 'position'] as const;
export type FindBy = (typeof FIND_BY)[number];

/** What one direction (import or export) of a kind of data offers. */
export interface Direction {
  operations: Operation[];
  /** How `find` finds a record: by the reference we sent, by a time window, near a position. */
  findBy?: FindBy[];
}

export interface DiveExport extends Direction {
  /** `confirmed`: an ID comes back. `handed_over`: delivered without one (QR, browser automation), so no update or delete. */
  delivery: 'confirmed' | 'handed_over';
  /** The Dive site's External ID at this site Source is needed before sending (SSI site ID). */
  needsSiteIdFrom?: SiteSource;
  /** Field names a read-back reports differences under; clients translate them. */
  readBackFields?: string[];
}

export interface Capabilities {
  /** Proper name, the same in every UI language. */
  name: string;
  signIn: SignIn;
  data: {
    dives?: { export?: DiveExport; import?: Direction };
    diveSites?: { import?: Direction };
  };
  /** Things a client must say about this Provider, e.g. that it shows dives sent this way as unconfirmed. */
  notices: ('shows_unconfirmed')[];
  limits: {
    /** Pause between two actions on one Connection, in ms. */
    pauseMs: number;
  };
}

/** Why the Provider didn't do what was asked; the generic layer turns it into a problem code. */
export type ProviderErrorReason = 'wrong_credentials' | 'signed_out' | 'refused' | 'unavailable' | 'bad_response';

export class ProviderError extends Error {
  constructor(readonly reason: ProviderErrorReason, detail: string) {
    super(`${reason}: ${detail}`);
  }
}

/** What the User typed to sign in. */
export type SignInInput =
  | { kind: 'password'; login: string; password: string }
  | { kind: 'token'; token: string };

export interface SignedIn {
  /** The account at the Provider: its stable ID (SSI: user master ID) and what the User recognises it by. */
  account: { id: string; label: string };
  /** What later calls carry (a token). Sealed by the generic layer, never returned by the API. */
  access: string;
}

export interface Series {
  offsetsMs: number[];
  values: number[];
}

/** A Dive as it leaves Dive Hub, the same for every Provider. Times are ours: UTC plus the offset at the dive. */
export interface OutgoingDive {
  startsAt: Date;
  utcOffsetSeconds: number | null;
  durationSeconds: number;
  maxDepthM: number | null;
  avgDepthM: number | null;
  /** Lowest water temperature, as on the Dive. */
  waterTemperatureC: number | null;
  maxTemperatureC: number | null;
  /** The Dive site's water type (ADR 0025). */
  waterType: SiteWaterType | null;
  notes: string | null;
  /** The Dive site's External IDs by Source (e.g. its SSI site ID). */
  siteIds: Partial<Record<SiteSource, string>>;
  entry: { latitude: number; longitude: number } | null;
  exit: { latitude: number; longitude: number } | null;
  /** The first gas is the one single-gas logbooks describe. */
  gases: { o2: number; he: number }[];
  gfLow: number | null;
  gfHigh: number | null;
  cnsStart: number | null;
  cnsEnd: number | null;
  device: { manufacturer: string; product: string | null; serialNumber: string; firmware: string | null } | null;
  samples: { depth?: Series | undefined; temperature?: Series | undefined; ndl?: Series | undefined };
}

/** A dive as the Provider keeps it, in typed values. */
export interface RemoteDive {
  remoteId: string;
  number: number | null;
  /** Local time as the Provider keeps it, "YYYY-MM-DD HH:MM". */
  startsAt: string | null;
  maxDepthM: number | null;
  durationMinutes: number | null;
}

export interface ReadBackDifference {
  field: string;
  sent: string | number | null;
  stored: string | number | null;
}

/** What a create or update left at the Provider. */
export interface Delivered {
  /** Null when delivery is `handed_over`. */
  remoteId: string | null;
  remoteNumber: number | null;
  /** The record sent, without bulky parts such as samples. */
  payload: Record<string, unknown> | null;
  /** What the Provider stored differently; null when it couldn't be read back (or doesn't read back). */
  differences: ReadBackDifference[] | null;
}

/** Who an action is for: the Connection's ID and account, and what calls carry. */
export interface ActionContext {
  connectionId: string;
  accountId: string;
  access: string;
}

/** The dive operations of one action. An adapter may share reads between them (one logbook read per action). */
export interface DiveExportAction {
  /** A dive we sent before (by our reference), and one at about the same time, if the Provider has them. */
  find?(dive: OutgoingDive, reference: string): Promise<{ ours: RemoteDive | null; sameTime: RemoteDive | null }>;
  create(dive: OutgoingDive, reference: string): Promise<Delivered>;
  /** Null when the remote dive is gone (deleted at the Provider). */
  update?(remoteId: string, dive: OutgoingDive): Promise<Delivered | null>;
  /** `gone`: it was already deleted at the Provider. */
  remove?(remoteId: string): Promise<'deleted' | 'gone'>;
}

/** A dive site at the Provider, to take its site ID from. */
export interface RemoteSite {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** As the Provider gives it. */
  country: string | null;
}

export interface ProviderAdapter {
  id: ProviderId;
  capabilities: Capabilities;
  /** The Diver External ID Source a connected account becomes (SSI: its account ID on the Diver), if any. */
  accountSource?: DiverSource;
  /** Signs in with what the User typed. Throws ProviderError. */
  signIn(input: SignInInput): Promise<SignedIn>;
  dives?: {
    /** How dives get there, as recorded on each Push. */
    mode: 'api' | 'qr';
    /** What decides "outdated": a hash of what this Provider receives of the Dive. */
    fingerprint(dive: OutgoingDive): string;
    open(context: ActionContext): DiveExportAction;
  };
  diveSites?: {
    /** The Provider's sites the User can pick from (SSI: the sites in their logbook). */
    find(context: ActionContext): Promise<RemoteSite[]>;
  };
}
