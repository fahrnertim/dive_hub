/** The parts of the account page, one at a time; the part is in the address ("#/account?tab=connections"). */
export const ACCOUNT_TABS = ['account', 'connections', 'ai'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

export function accountTab(params: URLSearchParams): AccountTab {
  const tab = params.get('tab');
  return ACCOUNT_TABS.find((t) => t === tab) ?? 'account';
}

export function accountHref(tab: AccountTab): string {
  return tab === 'account' ? '#/account' : `#/account?tab=${tab}`;
}

/** A Connection's settings on the account page ("#/account?tab=connections&connection=<id>"): the page goes to them. */
export function connectionHref(connectionId: string): string {
  return `${accountHref('connections')}&connection=${encodeURIComponent(connectionId)}`;
}
