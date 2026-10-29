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
} from "./schemas";
import { resetActivityUid } from "./activities";

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
      qc.invalidateQueries({ queryKey: ["safety"] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["biometrics"] }),
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
      qc.invalidateQueries({ queryKey: ["safety"] });
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
      qc.invalidateQueries({ queryKey: ["safety"] });
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
      qc.invalidateQueries({ queryKey: ["safety"] });
    },
  });
}
