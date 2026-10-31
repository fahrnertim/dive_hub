// SearchList (ux-search): the results under the field, the typed part marked, picked by keyboard or tap; nothing is
// picked while a pick is being saved.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchList, type SearchListItem } from '../src/ui/SearchList.tsx';

const SITES: SearchListItem[] = [
  { id: 'a', name: 'Blaue Grotte' },
  { id: 'b', name: 'Côte Bleue' },
  { id: 'c', name: 'Walensee' },
];

/** A caller that narrows the items itself, as SearchList expects. */
function Sites({ onPick, isPending }: { onPick: (id: string) => void; isPending?: boolean }) {
  const [query, setQuery] = useState('');
  const items = SITES.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <SearchList
      label="Dive site" listLabel="Sites" query={query} onQueryChange={setQuery} items={items} onPick={onPick}
      empty="No site found" {...(isPending !== undefined && { isPending, pendingStatus: 'Saving…' })}
    />
  );
}

describe('SearchList', () => {
  it('marks the typed part of each name, ignoring case and accents', async () => {
    render(<SearchList label="Dive site" listLabel="Sites" query="cote" onQueryChange={() => {}} items={SITES.slice(1, 2)} onPick={() => {}} />);
    expect(screen.getByRole('option').querySelector('mark')?.textContent).toBe('Côte');
  });

  it('shows what the caller narrowed to, and its empty text when nothing is left', async () => {
    const user = userEvent.setup();
    render(<Sites onPick={() => {}} />);
    await user.type(screen.getByRole('searchbox', { name: 'Dive site' }), 'see');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Walensee']);
    await user.type(screen.getByRole('searchbox'), 'xyz');
    expect(screen.getByText('No site found')).toBeTruthy();
  });

  it('picks the result the arrow keys reach with Enter, and a tapped one', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Sites onPick={onPick} />);
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenLastCalledWith('b');
    await user.click(screen.getByRole('option', { name: 'Walensee' }));
    expect(onPick).toHaveBeenLastCalledWith('c');
  });

  it('picks nothing while a pick is being saved, and says so', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Sites onPick={onPick} isPending />);
    expect(screen.getByRole('status').textContent).toBe('Saving…');
    await user.click(screen.getByRole('option', { name: 'Walensee' }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
