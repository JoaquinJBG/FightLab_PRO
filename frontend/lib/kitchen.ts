"use client";

// Perfil de cocina (fase 12, `GET/PUT /coach/kitchen`): el menaje y los comensales con sus
// restricciones por comida. Lo rellena el usuario; el cronograma de batch solo usa los aparatos que
// tiene, y el generador de menús y la comprobación del motor respetan a los comensales.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { MEALS, MenuError, type MealKey } from "./menu";

export const EQUIPMENT_COUNTS = ["pots", "pressure_cookers", "frying_pans", "burners_large", "burners_small"] as const;
export const EQUIPMENT_FLAGS = ["wok", "air_fryer", "oven", "microwave"] as const;
export type EquipmentCount = (typeof EQUIPMENT_COUNTS)[number];
export type EquipmentFlag = (typeof EQUIPMENT_FLAGS)[number];

export const equipment = z.object({
  pots: z.number().optional(),
  pressure_cookers: z.number().optional(),
  wok: z.boolean().optional(),
  frying_pans: z.number().optional(),
  air_fryer: z.boolean().optional(),
  air_fryer_model: z.string().optional(),
  oven: z.boolean().optional(),
  microwave: z.boolean().optional(),
  burners_large: z.number().optional(),
  burners_small: z.number().optional(),
});
export type Equipment = z.infer<typeof equipment>;

export const restriction = z.object({
  meals: z.array(z.enum(MEALS)),
  exclude: z.array(z.string()),
  allow: z.array(z.string()),
});
export type Restriction = z.infer<typeof restriction>;

export const diner = z.object({ id: z.number().optional(), name: z.string(), restrictions: z.array(restriction) });
export type Diner = z.infer<typeof diner>;

export const kitchenState = z.object({
  equipment,
  filled: z.boolean(),
  limits: z.record(z.string(), z.array(z.number())),
  diners: z.array(diner),
  meals: z.array(z.enum(MEALS)),
  categories: z.array(z.string()),
  categories_convention: z.string(),
});
export type KitchenState = z.infer<typeof kitchenState>;

export const MAX_DINERS = 8;

async function send(method: string, body?: unknown) {
  const res = await fetch("/api/proxy/coach/kitchen", {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MenuError(typeof data?.code === "string" ? data.code : String(res.status), "", data);
  return kitchenState.parse(data);
}

export function useKitchen() {
  return useQuery<KitchenState>({ queryKey: ["kitchen"], queryFn: () => send("GET") });
}

export function useSaveKitchen() {
  const qc = useQueryClient();
  return useMutation<KitchenState, MenuError, { equipment?: Equipment; diners?: Diner[] }>({
    mutationFn: (body) => send("PUT", body),
    onSuccess: (data) => {
      qc.setQueryData(["kitchen"], data);
      qc.invalidateQueries({ queryKey: ["menu"] });
    },
  });
}

/** Lo que se manda de un comensal: sin restricciones vacías ni el id. */
export function cleanDiners(list: Diner[]): Diner[] {
  return list
    .filter((d) => d.name.trim())
    .map((d) => ({
      name: d.name.trim(),
      restrictions: d.restrictions
        .map((r) => ({ meals: r.meals, exclude: r.exclude.filter(Boolean), allow: r.allow.filter(Boolean) }))
        .filter((r) => r.exclude.length > 0),
    }));
}

/** "cena sin pescado salvo gambas" como texto para enseñar una restricción. */
export function restrictionParts(r: Restriction): { meals: MealKey[]; exclude: string; allow: string } {
  return { meals: r.meals, exclude: r.exclude.join(", "), allow: r.allow.join(", ") };
}
