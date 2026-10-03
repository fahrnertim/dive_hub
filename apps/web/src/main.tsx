import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { isUnauthorized, keys } from './api.ts';
import './i18n/index.ts';
import './design/tokens.css';
import './design/base.css';
import './ui/ui.css';
import './pages.css';

// A 401 from any call means the session ended (expired or signed out elsewhere): show sign-in.
const onError = (error: unknown) => {
  if (isUnauthorized(error)) queryClient.setQueryData(keys.me, null);
};
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (count, error) => !isUnauthorized(error) && count < 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
