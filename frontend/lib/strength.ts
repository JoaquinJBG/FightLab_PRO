"use client";

// "Última vez" y récords del gimnasio desde el servidor (`GET /coach/strength/last`): salen de
// `SetLog` (las series del gimnasio de la app, las importadas y las que se migraron del
// navegador) y el e1RM es el del coach. Mientras el servidor no tiene un ejercicio (sesión aún en
// la cola offline, sin conexión), se usa lo guardado en el navegador.

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { exerciseStats } from "./gym";
import { DEFAULT_LOCALE, formatNumber } from "./locale";

export const lastStats = z.object({
  last: z
    .object({ date: z.string(), sets: z.number(), reps: z.number().nullable(), weight_kg: z.number().nullable() })
    .nullable(),
  pr_kg: z.number().nullable(),
  best_e1rm_kg: z.number().nullable(),
});
export type LastStats = z.infer<typeof lastStats>;

export const lastResponse = z.object({
  exercises: z.record(z.string(), lastStats),
  convention: z.string(),
});

export function useLastStats(names: string[]) {
  const unique = [...new Set(names)].sort();
  return useQuery({
    queryKey: ["strength-last", unique],
    enabled: unique.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const qs = unique.map((n) => `exercise=${encodeURIComponent(n)}`).join("&");
      const res = await fetch(`/api/proxy/coach/strength/last?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return lastResponse.parse(await res.json()).exercises;
    },
  });
}

export type GymStats = { last: string | null; prKg: number | null; e1rmKg: number | null; fromServer: boolean };

const fmtLast = (l: NonNullable<LastStats["last"]>, locale: string) =>
  `${l.sets}×${l.reps ?? "—"}${l.weight_kg ? ` · ${formatNumber(locale, l.weight_kg, { max: 2 })} kg` : ""}`;

/** Lo del servidor si tiene el ejercicio; si no, lo del navegador. El récord es el mayor de los
 * dos (una sesión recién guardada puede no haber llegado aún). */
export function gymStats(name: string, server: Record<string, LastStats> | undefined, locale: string = DEFAULT_LOCALE): GymStats {
  const local = exerciseStats(name, undefined, locale);
  const s = server?.[name];
  if (!s?.last) return { last: local.last, prKg: local.prKg, e1rmKg: null, fromServer: false };
  const prs = [s.pr_kg, local.prKg].filter((v): v is number => v !== null);
  return { last: fmtLast(s.last, locale), prKg: prs.length ? Math.max(...prs) : null, e1rmKg: s.best_e1rm_kg, fromServer: true };
}
