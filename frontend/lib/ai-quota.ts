"use client";

// Cupo diario de IA del usuario (GET /ai/quota, tabla AIUsage del backend).
// Vive fuera de hooks.ts/schemas.ts por las reglas de reparto de archivos del
// plan de auditoría; la UI del coach que lo muestra llega en WP-18.

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError } from "./hooks";

const quotaEntry = z.object({
  // null = sin límite configurado en el servidor
  limit: z.number().int().nullable(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative().nullable(),
});

export const aiQuota = z.object({
  date: z.string(),
  coach: quotaEntry,
  photo: quotaEntry,
});

export type AIQuota = z.infer<typeof aiQuota>;
export type AIQuotaEntry = z.infer<typeof quotaEntry>;

export const AI_QUOTA_QUERY_KEY = ["ai-quota"] as const;

/** Códigos estables que el backend pone en `code` al rechazar por coste. */
export const AI_LIMIT_CODES = {
  userDaily: "quota_daily", // 429: el usuario agotó su cupo de hoy
  serviceDaily: "budget_daily", // 503: el servicio agotó su presupuesto de hoy
} as const;

export type AILimitCode = (typeof AI_LIMIT_CODES)[keyof typeof AI_LIMIT_CODES];

/** Devuelve el código de límite diario de una respuesta de error de IA, si lo trae. */
export function aiLimitCode(body: unknown): AILimitCode | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return code === AI_LIMIT_CODES.userDaily || code === AI_LIMIT_CODES.serviceDaily ? code : null;
}

export async function fetchAIQuota(): Promise<AIQuota> {
  const res = await fetch("/api/proxy/ai/quota", { credentials: "include" });
  if (!res.ok) throw new ApiError(String(res.status), res.status);
  return aiQuota.parse(await res.json());
}

export function useAIQuota() {
  return useQuery<AIQuota>({
    queryKey: AI_QUOTA_QUERY_KEY,
    queryFn: fetchAIQuota,
    staleTime: 60_000,
  });
}
