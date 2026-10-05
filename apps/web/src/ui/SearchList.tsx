import type { ReactNode } from 'react';
import { Autocomplete, Input, Label, ListBox, ListBoxItem, SearchField, Text } from 'react-aria-components';

export interface SearchListItem {
  id: string;
  /** The item's name, as shown; the part matching the query is marked. */
  name: string;
  /** A quieter second line, e.g. distance, country and body of water. */
  detail?: ReactNode;
  /** Beside the name, e.g. "current". */
  badge?: ReactNode;
  /** Read by screen readers and typeahead; defaults to the name. */
  textValue?: string;
}

/** Where `query` appears in `name`, ignoring case and accents; the rest of the name as is. */
function marked(name: string, query: string): ReactNode {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  if (!q) return name;
  // Folding can change lengths ("ß"); compare per character so the offsets stay in the original name.
  const chars = [...name];
  const folded = chars.map(fold);
  for (let i = 0; i < chars.length; i++) {
    let j = i;
    let acc = '';
    while (j < chars.length && acc.length < q.length) acc += folded[j++];
    if (acc === q) {
      return <>{chars.slice(0, i).join('')}<mark className="match">{chars.slice(i, j).join('')}</mark>{chars.slice(j).join('')}</>;
    }
  }
  return name;
}

/**
 * A search field with its results right under it, updated while typing (ux-search): focus stays in the field,
 * arrow keys move through the results, Enter or a tap picks one. Built on React Aria's Autocomplete, so screen
 * readers hear a search field that controls a list, with the active result (aria-activedescendant). The caller fetches and narrows the items; nothing is filtered here.
 */
export function SearchList({ label, description, query, onQueryChange, items, onPick, listLabel, status, empty, autoFocus, isPending, pendingStatus, isDisabled }: {
  label: string;
  description?: ReactNode;
  query: string;
  onQueryChange: (q: string) => void;
  items: SearchListItem[];
  onPick: (id: string) => void;
  /** Names the list for screen readers, e.g. "Near this dive". */
  listLabel: string;
  /** Above the list: what it shows, how many match, or that it is loading. Announced politely. */
  status?: ReactNode;
  /** In place of the list when there is nothing. */
  empty?: ReactNode;
  autoFocus?: boolean;
  /** Picking is being saved: the rows wait, and `pendingStatus` replaces the status. */
  isPending?: boolean;
  pendingStatus?: ReactNode;
  isDisabled?: boolean;
}) {
  const busy = isPending ?? false;
  const disabled = busy || (isDisabled ?? false);
  return (
    <div className="search-list">
      <Autocomplete inputValue={query} onInputChange={onQueryChange}>
        <SearchField className="field" {...(autoFocus && { autoFocus })} isDisabled={isDisabled ?? false}>
          <Label className="field-label">{label}</Label>
          <Input className="input" autoComplete="off" />
          {description && <Text slot="description" className="field-description">{description}</Text>}
        </SearchField>
        {(busy ? pendingStatus : status) && <p className="search-list-status" role="status">{busy ? pendingStatus : status}</p>}
        <ListBox
          aria-label={listLabel} className="search-list-items" items={items} aria-busy={busy || undefined}
          onAction={(key) => { if (!disabled) onPick(String(key)); }}
          renderEmptyState={() => empty ?? null}
        >
          {(item) => (
            <ListBoxItem id={item.id} textValue={item.textValue ?? item.name} className="search-list-item" isDisabled={disabled}>
              <span className="search-list-name"><span translate="no">{marked(item.name, query)}</span>{item.badge}</span>
              {item.detail && <span className="search-list-detail">{item.detail}</span>}
            </ListBoxItem>
          )}
        </ListBox>
      </Autocomplete>
    </div>
  );
}
