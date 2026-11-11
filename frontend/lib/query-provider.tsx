"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { useState } from "react";
import { handleQueryError } from "./hooks";
import { watchOfflineQueue } from "./offline";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const onError = (err: unknown) => handleQueryError(qc, err);
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    // Sin red, dos cambios del mismo campo no se quedan los dos en cola: gana el último (F5).
    watchOfflineQueue(qc.getMutationCache());
    // React Query empieza creyendo que hay red; si la app se abre ya sin ella (desde la caché del
    // service worker), que lo sepa desde el principio y deje los cambios en cola.
    if (typeof window !== "undefined" && navigator.onLine === false) onlineManager.setOnline(false);
    return qc;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
