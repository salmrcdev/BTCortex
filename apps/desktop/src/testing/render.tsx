import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initialiseI18n } from '@/i18n';

// Renders a page inside the providers it needs (router, query cache,
// tooltips, translations), with retries off so failures surface immediately.

export async function renderPage(page: ReactNode, initialPath = '/') {
  await initialiseI18n();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => page });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => page });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, pageRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, router };
}
