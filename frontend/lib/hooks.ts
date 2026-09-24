"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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
import { flushUserState, resetUserStateQueue } from "./user-state";

// Claves flp_* que son preferencias del DISPOSITIVO (no del usuario): sobreviven
// al logout para no reconfigurar el timer de rounds o el descanso del gimnasio
// cada vez que alguien más usa el móvil.
const KEEP_ON_LOGOUT = new Set(["flp_round_cfg", "flp_gym_rest"]);

/** Borra el estado local de la cuenta que cierra sesión: todas las claves
    `flp_*` del dispositivo salvo las preferencias de arriba. En un móvil
    compartido, así el siguiente usuario no ve la carga, la nutrición ni el
    peso del anterior (esas claves no van namespaced por uid).
    NO toca `flp_pending_acts_*`/`flp_pending_dels_*`/`flp_pending_state_*` de
    OTRO uid: puede haber quedado la cola sin subir de una cuenta anterior en
    este mismo móvil, y borrarla a ciegas perdería esos entrenos (o esa
    nutrición/peso/coach_memory) para siempre. */
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
      const pending = /^flp_pending_(acts|dels|state)_(.+)$/.exec(k);
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

// Margen por debajo del límite de ~4.5 MB que Vercel impone al cuerpo de las
// funciones del BFF. compressImage() ya deja los archivos muy por debajo de
// esto (<1.5 MB); este tope solo entra en juego en su fallback, cuando el
// navegador no puede comprimir (p. ej. HEIC fuera de Safari) y se sube el
// archivo original tal cual.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          "La foto pesa demasiado para subirla sin comprimir. Prueba con otra foto o desde otro navegador.",
        );
      }
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

/** Deja en caché el perfil que devuelve el PATCH. No basta con invalidar: en
 *  /onboarding nadie observa ["profile"], así que invalidar solo lo marca como
 *  viejo y el OnboardingGate del shell leería al instante el perfil incompleto
 *  cacheado y devolvería al usuario a /onboarding en bucle. */
export function applyProfileUpdate(qc: QueryClient, data: unknown) {
  const parsed = profile.safeParse(data);
  if (parsed.success) qc.setQueryData(["profile"], parsed.data);
  else qc.removeQueries({ queryKey: ["profile"] });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      sendJson("/api/proxy/me/profile", "PATCH", payload),
    onSuccess: (data) => applyProfileUpdate(qc, data),
  });
}

// Extraído de useLogout para poder probarlo sin un árbol de React (no hay
// react-testing-library en este proyecto): son las mismas funciones que usa
// el `useMutation` de abajo, expuestas solo para el test.

/** Mejor esfuerzo: intenta subir lo pendiente de ESTA cuenta (entrenos y
 *  user-state) antes de cerrar sesión y borrar el dispositivo. Si falla (sin
 *  red, servidor dormido), se sigue con el logout igualmente: es una copia de
 *  seguridad, no un requisito para poder salir. Devuelve el uid capturado
 *  ANTES de que nada lo borre. */
export async function performLogout(): Promise<string | null> {
  const uid = cachedActivityUid();
  await flushActivities().catch(() => false);
  await flushUserState().catch(() => undefined);
  await sendJson("/api/auth/logout", "POST");
  return uid;
}

/** Limpieza del dispositivo tras un logout con éxito. ANTES de
 *  `clearDeviceState`: cancela timers/listeners de la cola de user-state para
 *  que un reintento ya agendado no se dispare con las cookies de la SIGUIENTE
 *  cuenta que entre en esta misma pestaña (sin recarga completa). */
export function finishLogout(qc: { clear: () => void }, uid: string | null): void {
  qc.clear();
  resetUserStateQueue();
  clearDeviceState(uid);
  resetActivityUid(); // que nada se encole a nombre del usuario saliente
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: performLogout,
    onSuccess: (uid) => finishLogout(qc, uid),
  });
}
