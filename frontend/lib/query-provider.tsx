"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { handleQueryError } from "./hooks";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const onError = (err: unknown) => handleQueryError(qc, err);
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    return qc;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
