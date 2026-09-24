"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  biometrics,
  me,
  profile,
  progressPhoto,
  type Biometrics,
  type Me,
  type Profile,
  type ProgressPhoto,
} from "./schemas";
import { resetActivityUid, cachedActivityUid, flushActivities } from "./activities";

// Claves flp_* que son preferencias del DISPOSITIVO (no del usuario): sobreviven
// al logout para no reconfigurar el timer de rounds o el descanso del gimnasio
// cada vez que alguien más usa el móvil.
const KEEP_ON_LOGOUT = new Set(["flp_round_cfg", "flp_gym_rest"]);

/** Borra el estado local de la cuenta que cierra sesión: todas las claves
    `flp_*` del dispositivo salvo las preferencias de arriba. En un móvil
    compartido, así el siguiente usuario no ve la carga, la nutrición ni el
    peso del anterior (esas claves no van namespaced por uid).
    NO toca `flp_pending_acts_*`/`flp_pending_dels_*` de OTRO uid: puede haber
    quedado la cola sin subir de una cuenta anterior en este mismo móvil, y
    borrarla a ciegas perdería esos entrenos para siempre. */
export function clearDeviceState(currentUid: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      if (!k.startsWith("flp_") || KEEP_ON_LOGOUT.has(k)) continue;
      const pending = /^flp_pending_(acts|dels)_(.+)$/.exec(k);
      if (pending && pending[2] !== currentUid) continue; // pendiente de otro uid: se conserva
      localStorage.removeItem(k);
    }
  } catch { /* noop */ }
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["biometrics"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const uid = cachedActivityUid(); // capturarlo ANTES de que nada lo borre
      // Mejor esfuerzo: intenta subir lo pendiente de ESTA cuenta antes de
      // cerrar sesión y borrar el dispositivo. Si falla (sin red, servidor
      // dormido), se sigue con el logout igualmente: es una copia de
      // seguridad, no un requisito para poder salir.
      await flushActivities().catch(() => false);
      await sendJson("/api/auth/logout", "POST");
      return uid;
    },
    onSuccess: (uid) => {
      qc.clear();
      clearDeviceState(uid);
      resetActivityUid(); // que nada se encole a nombre del usuario saliente
    },
  });
}
