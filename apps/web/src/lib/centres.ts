import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { keys, type CentreView } from '../api.ts';

/** The centre's SSI centre number, if it has one. */
export const ssiNumber = (c: CentreView) => c.externalIds.find((e) => e.source === 'ssi')?.externalId;

/** What changes a centre changes the codes Dives show (ADR 0043). */
export function useCentreRefresh() {
  const queryClient = useQueryClient();
  return async (updated?: CentreView) => {
    if (updated) queryClient.setQueryData(keys.centre(updated.id), updated);
    await queryClient.invalidateQueries({ queryKey: keys.centres });
    await queryClient.invalidateQueries({ queryKey: keys.dives });
  };
}

/** The search text, trimmed, once typing has paused. */
export function useDebounced(text: string) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  return q;
}
