"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";

/**
 * Client providers: TanStack Query (extraction request + SSE-backed job cache)
 * and the Sonner toaster. Mounted inside ThemeProvider so the toaster picks up
 * the current theme.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}
