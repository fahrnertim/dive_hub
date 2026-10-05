// A list's search field whose words live in the address (#/sites?q=…, #/?q=…), so a reload or a shared link
// keeps them. The page is not rebuilt when the address changes (App keys pages by path), so the field keeps
// focus while the results update; this keeps the field and the address in step.
import { useEffect, useRef, useState } from 'react';

/** How long typing pauses before the address (and so the results) follow. */
const PAUSE_MS = 300;

/**
 * The field's text for the address's `q`: typing writes it (`write`, replacing the address) after a pause; a
 * change from elsewhere (a link, the menu, Back) replaces the text. What the field wrote itself never resets it,
 * so words typed while the results load stay.
 */
export function useAddressSearch(q: string | undefined, write: (q: string | undefined) => void): [string, (text: string) => void] {
  const [text, setText] = useState(q ?? '');
  const written = useRef(q ?? '');
  const writeRef = useRef(write);
  writeRef.current = write;

  useEffect(() => {
    if ((q ?? '') === written.current) return;
    written.current = q ?? '';
    setText(q ?? '');
  }, [q]);

  useEffect(() => {
    const words = text.trim();
    if (words === written.current) return;
    const timer = setTimeout(() => {
      written.current = words;
      writeRef.current(words || undefined);
    }, PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return [text, setText];
}
