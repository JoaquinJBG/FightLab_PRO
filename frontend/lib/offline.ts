"use client";

/* Sin conexión (F5 de la prueba en móvil).
 *
 * React Query deja en pausa las mutaciones que se lanzan sin red y las manda solas al volver.
 * Aquí se añade lo que faltaba: un aviso de «pendiente de enviar» y que no se queden en cola dos
 * cambios del mismo campo (por ejemplo, marcar y desmarcar «Movilidad» sin red): gana el último. */

import { useSyncExternalStore } from "react";
import { onlineManager, useMutationState, type MutationCache } from "@tanstack/react-query";

type AnyMutation = ReturnType<MutationCache["getAll"]>[number];

/** `meta` de una mutación que se puede sustituir en la cola: a qué campo toca, según sus
 * variables. Dos mutaciones en pausa con la misma clave y el mismo campo: sobra la vieja. */
export type OfflineMeta = { offlineField?: (vars: unknown) => string | null };

function fieldOf(m: AnyMutation): string | null {
  const meta = m.options.meta as OfflineMeta | undefined;
  if (!meta?.offlineField) return null;
  const field = meta.offlineField(m.state.variables);
  return field === null ? null : `${JSON.stringify(m.options.mutationKey ?? [])}|${field}`;
}

/** Quita de la cola las mutaciones en pausa que una más nueva del mismo campo deja sin sentido. */
export function dropSuperseded(cache: MutationCache): number {
  const latest = new Map<string, AnyMutation>();
  const stale: AnyMutation[] = [];
  for (const m of cache.getAll()) {
    if (!m.state.isPaused) continue;
    const key = fieldOf(m);
    if (key === null) continue;
    const prev = latest.get(key);
    if (!prev) latest.set(key, m);
    else if (prev.mutationId < m.mutationId) {
      stale.push(prev);
      latest.set(key, m);
    } else stale.push(m);
  }
  for (const m of stale) cache.remove(m);
  return stale.length;
}

/** Engancha `dropSuperseded` a la caché: se mira cada vez que una mutación entra en pausa. */
export function watchOfflineQueue(cache: MutationCache): () => void {
  return cache.subscribe((event) => {
    if (event.type === "updated" && event.mutation?.state.isPaused) dropSuperseded(cache);
  });
}

/** Campo de un parche `{campo: valor}`: las claves, ordenadas. */
export const patchField = (vars: unknown): string | null =>
  vars && typeof vars === "object" ? Object.keys(vars).sort().join(",") : null;

/** ¿Hay red? Según React Query (eventos `online`/`offline` del navegador). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Cuántos cambios esperan a la red para enviarse. */
export function usePendingCount(): number {
  return useMutationState({ filters: { predicate: (m) => m.state.isPaused } }).length;
}
