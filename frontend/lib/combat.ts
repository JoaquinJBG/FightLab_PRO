"use client";

// Golpes en la cabeza y bloqueo del contacto (E.5). El flag `no_contact` lo calcula el servidor
// (`/coach/safety`); aquí solo se avisa del golpe y se confirma el alta de un clínico.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Safety } from "./schemas";

export const headImpact = z.object({
  id: z.number(),
  occurred_on: z.string(),
  symptoms: z.boolean(),
  red_flags: z.boolean(),
  origin: z.string(),
  cleared_on: z.string().nullable(),
  cleared_by: z.string().nullable(),
});
export type HeadImpact = z.infer<typeof headImpact>;

const BASE = "/api/proxy/coach/head-impacts";

async function send(path: string, method: string, body: unknown) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return headImpact.parse(await res.json());
}

export function useHeadImpacts(enabled = true) {
  return useQuery<HeadImpact[]>({
    queryKey: ["head-impacts"],
    queryFn: async () => {
      const res = await fetch(BASE, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return z.array(headImpact).parse(await res.json());
    },
    enabled,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["head-impacts"] });
    qc.invalidateQueries({ queryKey: ["safety"] });
  };
}

export function useReportHeadImpact() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { symptoms: boolean; red_flags: boolean; origin: string }) => send(BASE, "POST", body),
    onSuccess: invalidate,
  });
}

/** El atleta confirma el alta de un clínico: se cierran todos los golpes que bloquean. */
export function useClearContact() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ ids, clearedOn, clearedBy }: { ids: number[]; clearedOn: string; clearedBy: string | null }) =>
      Promise.all(ids.map((id) => send(`${BASE}/${id}`, "PATCH", { cleared_on: clearedOn, cleared_by: clearedBy }))),
    onSuccess: invalidate,
  });
}

export const blocksContact = (i: HeadImpact) => (i.symptoms || i.red_flags) && i.cleared_on == null;

/** `no_contact` de `/coach/safety` (falso mientras carga o si falla). */
export const noContact = (s: Safety | undefined) => !!s?.flags.no_contact;

/** Tipos de trabajo del registro de MMA con contacto o compañero (combat-sports "No sparring
 * until symptom-free with exertion and cleared"): sparring, drills y pads con compañero. */
export const CONTACT_WORK = ["Sparring", "Drilling", "Pads"] as const;
export const isContactWork = (type: string) => (CONTACT_WORK as readonly string[]).includes(type);

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
