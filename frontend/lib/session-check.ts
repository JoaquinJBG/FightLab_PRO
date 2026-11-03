"use client";

// Aviso al registrar a mano una sesión vigorosa (spec §8.2). Qué modalidad es la sesión y si los
// flags de seguridad piden el aviso lo decide el servidor (`GET /coach/session-check`).

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { coachReason } from "./schemas";

export type SessionCheckParams =
  | { kind: "MMA"; work_type: string; art: string; rpe: number | null }
  | { kind: "SPORT"; sport_key: string; sport_format: SportFormat }
  | { kind: "GYM"; includes: GymInclude[] };

export const SPORT_FORMATS = ["continuous", "hiit", "sprints"] as const;
export type SportFormat = (typeof SPORT_FORMATS)[number];
export const GYM_INCLUDES = ["one_rm_test", "plyometrics"] as const;
export type GymInclude = (typeof GYM_INCLUDES)[number];

export const sessionCheck = z.object({
  modalities: z.array(
    z.object({
      key: z.string(),
      intensity: z.string(),
      rule_key: z.string().nullable(),
      grade: z.string().nullable(),
      convention: z.enum(["coach", "fightlab"]).nullable(),
      blocked_by: z.array(z.string()),
    }),
  ),
  rpe_basis: z
    .object({ threshold: z.number(), rule_key: z.string(), grade: z.string().nullable(), convention: z.enum(["fightlab"]).nullable() })
    .nullable(),
  warn: z.boolean(),
  flags: z.array(z.string()),
  reasons: z.array(coachReason),
  blocks_saving: z.boolean(),
});
export type SessionCheck = z.infer<typeof sessionCheck>;

export function sessionCheckQuery(p: SessionCheckParams): string {
  const q = new URLSearchParams({ kind: p.kind });
  if (p.kind === "MMA") {
    q.set("work_type", p.work_type);
    q.set("art", p.art);
    if (p.rpe !== null) q.set("rpe", String(p.rpe));
  } else if (p.kind === "SPORT") {
    q.set("sport_key", p.sport_key);
    q.set("sport_format", p.sport_format);
  } else {
    for (const i of p.includes) q.append("includes", i);
  }
  return q.toString();
}

export function useSessionCheck(p: SessionCheckParams | null) {
  const qs = p ? sessionCheckQuery(p) : "";
  return useQuery({
    queryKey: ["session-check", qs],
    enabled: p !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/proxy/coach/session-check?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return sessionCheck.parse(await res.json());
    },
  });
}
