import '@fontsource/fira-sans/400.css';
import '@fontsource/fira-sans/500.css';
import '@fontsource/fira-sans/600.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import '@fontsource/fira-code/600.css';
import './styles/globals.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { router } from '@/app/router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { bridgeOrchestratorEvents } from '@/features/nodes/queries';
import { initialiseI18n } from '@/i18n';
import { connectOrchestratorStatus } from '@/stores/orchestrator-status';
import { followTheme, useResolvedTheme } from '@/stores/preferences';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retries are bounded; the orchestrator applies its own back-off to services.
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function Notifications() {
  const theme = useResolvedTheme();
  return <Toaster theme={theme} position="bottom-right" closeButton toastOptions={{ className: 'font-sans' }} />;
}

async function start(): Promise<void> {
  followTheme();
  await initialiseI18n();
  await connectOrchestratorStatus();
  await bridgeOrchestratorEvents(queryClient);

  const container = document.getElementById('root');
  if (!container) throw new Error('The root element is missing from index.html.');
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Notifications />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
