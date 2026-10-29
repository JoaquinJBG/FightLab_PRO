"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  biometrics,
  engineInfo,
  ruleDetail,
  me,
  profile,
  progressPhoto,
  type Biometrics,
  type EngineInfo,
  type RuleDetail,
  type Me,
  type Profile,
  type ProgressPhoto,
  safety,
  screening,
  injury,
  type Safety,
  type Screening,
  type ScreeningValues,
  type Injury,
  targets,
  zones,
  weighIn,
  type Targets,
  type Zones,
  type WeighIn,
} from "./schemas";
import { resetActivityUid } from "./activities";

// Todo lo que el servidor calcula con el motor depende del perfil, el cribado y los pesos: si
// cambian, se vuelve a pedir.
function invalidateCoach(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["safety", "targets", "zones", "weigh-in"]) qc.invalidateQueries({ queryKey: [key] });
}

async function getJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function sendJson(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : String(res.status));
  }
  return data;
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => me.parse(await getJson("/api/proxy/me")),
  });
}

export function useProfile() {
  return useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: async () => profile.parse(await getJson("/api/proxy/me/profile")),
  });
}

export function useBiometrics() {
  return useQuery<Biometrics[]>({
    queryKey: ["biometrics"],
    queryFn: async () => z.array(biometrics).parse(await getJson("/api/proxy/me/biometrics")),
  });
}

export function useCreateBiometrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      sendJson("/api/proxy/me/biometrics", "POST", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["biometrics"] });
      invalidateCoach(qc);
    },
  });
}

export function useDeleteBiometrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/proxy/me/biometrics/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["biometrics"] });
      invalidateCoach(qc);
    },
  });
}

export function usePhotos() {
  return useQuery<ProgressPhoto[]>({
    queryKey: ["photos"],
    queryFn: async () => z.array(progressPhoto).parse(await getJson("/api/proxy/me/photos")),
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/proxy/me/photos", {
        method: "POST",
        credentials: "include",
        body: form, // sin Content-Type manual: fetch pone el boundary
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : String(res.status));
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/proxy/me/photos/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      sendJson("/api/proxy/me/profile", "PATCH", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
      invalidateCoach(qc);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson("/api/auth/logout", "POST"),
    onSuccess: () => {
      qc.clear();
      resetActivityUid(); // que nada se encole a nombre del usuario saliente
    },
  });
}

/** Versión del motor y fecha de la evidencia (pantalla de Créditos). */
export function useEngine() {
  return useQuery<EngineInfo>({
    queryKey: ["coach-engine"],
    queryFn: async () => engineInfo.parse(await getJson("/api/proxy/coach/engine")),
  });
}

/** Regla de la base de evidencia con sus fuentes (hoja de evidencia). */
export function useRule(key: string | null) {
  return useQuery<RuleDetail>({
    queryKey: ["knowledge-rule", key],
    enabled: !!key,
    queryFn: async () =>
      ruleDetail.parse(await getJson(`/api/proxy/knowledge/rules/${key}`)),
  });
}

/* --- Seguridad y cribado (coach, fase 3). Los flags los calcula el servidor. --- */

export function useSafety(enabled = true) {
  return useQuery<Safety>({
    queryKey: ["safety"],
    queryFn: async () => safety.parse(await getJson("/api/proxy/coach/safety")),
    enabled,
  });
}

export function useScreening() {
  return useQuery<Screening>({
    queryKey: ["screening"],
    queryFn: async () => screening.parse(await getJson("/api/proxy/coach/screening")),
  });
}

export function useUpdateScreening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<ScreeningValues>) =>
      screening.parse(await sendJson("/api/proxy/coach/screening", "PATCH", { values, origin: "onboarding" })),
    onSuccess: (data) => {
      qc.setQueryData(["screening"], data);
      invalidateCoach(qc);
    },
  });
}

export function useInjuries() {
  return useQuery<Injury[]>({
    queryKey: ["injuries"],
    queryFn: async () => z.array(injury).parse(await getJson("/api/proxy/coach/injuries")),
  });
}

export function useAddInjury() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => sendJson("/api/proxy/coach/injuries", "POST", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["injuries"] });
      qc.invalidateQueries({ queryKey: ["safety"] });
    },
  });
}

export function useDeleteInjury() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/proxy/coach/injuries/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["injuries"] });
      invalidateCoach(qc);
    },
  });
}

/* --- Objetivos, zonas y pesaje (coach, fase 4). Los calcula el servidor con el motor. --- */

/** `kind: "incomplete"` es el 409 del motor: falta un dato (`field`) para calcular. */
export type TargetsResult = { kind: "ok"; data: Targets } | { kind: "incomplete"; field: string };

export function useTargets() {
  return useQuery<TargetsResult>({
    queryKey: ["targets"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/coach/targets", { credentials: "include" });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        return { kind: "incomplete", field: typeof body?.field === "string" ? body.field : "" };
      }
      if (!res.ok) throw new Error(String(res.status));
      return { kind: "ok", data: targets.parse(await res.json()) };
    },
  });
}

export function useZones(enabled = true) {
  return useQuery<Zones>({
    queryKey: ["zones"],
    queryFn: async () => zones.parse(await getJson("/api/proxy/coach/zones")),
    enabled,
  });
}

export function useWeighIn(enabled = true) {
  return useQuery<WeighIn>({
    queryKey: ["weigh-in"],
    queryFn: async () => weighIn.parse(await getJson("/api/proxy/coach/weigh-in")),
    enabled,
  });
}

/** El servidor rechaza con `code` (`weight_targets_blocked`, `deficit_blocked`) un pesaje que
 * los avisos de seguridad no permiten; el error lo lleva para que la UI lo explique. */
export class WeighInError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code || String(status));
    this.status = status;
    this.code = code;
  }
}

export function useSaveWeighIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { goal_weight_kg: number; weigh_in_at: string; weight_class?: string | null }) => {
      const res = await fetch("/api/proxy/coach/weigh-in", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new WeighInError(res.status, typeof data?.code === "string" ? data.code : "");
      return weighIn.parse(data);
    },
    onSuccess: (data) => {
      qc.setQueryData(["weigh-in"], data);
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

export function useClearWeighIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/proxy/coach/weigh-in", { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weigh-in"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
