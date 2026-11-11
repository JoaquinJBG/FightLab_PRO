"use client";

// Historial de Gimnasio, MMA y Deportes desde el servidor (F17, fallo F1 de raíz).
//
// La fuente es `GET activities` paginado. Encima van las sesiones aún en la cola offline (para
// ver al momento lo recién guardado) y las añadidas en esta pantalla. La caché del navegador solo
// se usa si el servidor no responde. Guardar una sesión AÑADE a la lista: nunca la sustituye por
// lo de este dispositivo (lo que hacía que el historial «desapareciera» hasta recargar).

import { useCallback, useEffect, useMemo, useState } from "react";
import { mergeByClientId, pendingQueueItems, type ActivityKind, type ServerActivity, type SyncItem } from "./activities";
import { fetchHistoryPage } from "./gym-api";

export type HistoryItem = { client_id?: string | null; ts: number };

export type HistorySource<T extends HistoryItem> = {
  fromServer: (a: ServerActivity) => T;
  fromPending: (i: SyncItem) => T;
  /** La caché del navegador: solo si el servidor no responde. */
  local: () => T[];
};

/** Junta y ordena (lo más reciente primero). Los grupos de después ganan para un mismo
    client_id: sin servidor, lo local; después lo añadido aquí, lo pendiente y el servidor. */
export function mergeHistory<T extends HistoryItem>(opts: {
  server: T[] | null;
  pending: T[];
  added: T[];
  local: T[];
  hidden?: Set<string>;
}): T[] {
  const merged = mergeByClientId(opts.server === null ? opts.local : [], opts.added, opts.pending, opts.server ?? []);
  return merged
    .filter((x) => !(x.client_id && opts.hidden?.has(x.client_id)))
    .sort((a, b) => b.ts - a.ts);
}

export function useActivityHistory<T extends HistoryItem>(kind: ActivityKind, source: HistorySource<T>, pageSize = 50) {
  const [server, setServer] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState<T[]>([]);
  const [local, setLocal] = useState<T[]>([]);
  const [pending, setPending] = useState<T[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const { fromServer, fromPending, local: readLocal } = source;

  const loadPage = useCallback(async (offset: number) => {
    setLoading(true);
    const page = await fetchHistoryPage(kind, offset, pageSize);
    setLoading(false);
    if (page === null) {
      if (offset === 0) setFailed(true);
      return;
    }
    setFailed(false);
    const items = page.map(fromServer);
    setServer((cur) => (offset === 0 || cur === null ? items : [...cur, ...items]));
    setHasMore(page.length === pageSize);
    setPending(pendingQueueItems(kind).map(fromPending));
  }, [kind, pageSize, fromServer, fromPending]);

  useEffect(() => {
    // Lo local y lo pendiente se leen tras montar (no existen en el servidor de Next).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(readLocal());
    setPending(pendingQueueItems(kind).map(fromPending));
    void loadPage(0);
  }, [kind, loadPage, readLocal, fromPending]);

  const items = useMemo(
    () => mergeHistory({ server: failed ? null : server ?? (loading ? null : []), pending, added, local, hidden }),
    [server, failed, loading, pending, added, local, hidden],
  );

  return {
    items,
    /** El servidor aún no ha respondido o no responde: se ve lo de este dispositivo. */
    offline: failed,
    loading,
    hasMore: hasMore && !failed,
    loadMore: () => void loadPage(server?.length ?? 0),
    reload: () => void loadPage(0),
    /** Lo recién guardado en esta pantalla, al principio de la lista. */
    add: (item: T) => setAdded((xs) => [item, ...xs]),
    hide: (clientId: string) => setHidden((h) => new Set(h).add(clientId)),
    clear: () => { setServer([]); setAdded([]); setLocal([]); setPending([]); setHasMore(false); },
  };
}
