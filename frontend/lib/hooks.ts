"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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
  trend,
  checkinState,
  checkinResult,
  type Trend,
  type CheckinState,
  type Targets,
  type Zones,
  type WeighIn,
} from "./schemas";
import { resetActivityUid, cachedActivityUid, flushActivities } from "./activities";
import { flushUserState, resetUserStateQueue } from "./user-state";
import { PHOTO_TOO_LARGE } from "./compress-image";

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

/** Error de una petición al BFF con su status HTTP. El mensaje sigue siendo el
 *  status (o el `detail` del servidor) como antes. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

// Todo lo que el servidor calcula con el motor depende del perfil, el cribado y los pesos: si
// cambian, se vuelve a pedir.
function invalidateCoach(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["safety", "targets", "zones", "weigh-in", "trend", "checkin"]) qc.invalidateQueries({ queryKey: [key] });
}

async function getJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new ApiError(String(res.status), res.status);
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
    throw new ApiError(typeof data?.detail === "string" ? data.detail : String(res.status), res.status);
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
        // Código y no texto: la pantalla lo traduce (`biometrics.photos.tooLarge`).
        throw new Error(PHOTO_TOO_LARGE);
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
    onSuccess: (data) => {
      applyProfileUpdate(qc, data);
      invalidateCoach(qc);
    },
  });
}

// Extraído de useLogout para poder probarlo sin un árbol de React (no hay
// react-testing-library en este proyecto): son las mismas funciones que usa
// el `useMutation` de abajo, expuestas solo para el test.

const LOGOUT_TIMEOUT_MS = 10_000;
const LOGOUT_FLUSH_BUDGET_MS = 4_000;

/** Pide al BFF que cierre sesión (borra las cookies httpOnly). Mejor esfuerzo:
 *  el BFF responde 200 aunque Django falle, y aquí un fallo de red o un
 *  timeout solo se registra. */
async function requestLogout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("logout request failed", err);
  }
}

/** Mejor esfuerzo: intenta subir lo pendiente de ESTA cuenta (entrenos y
 *  user-state) antes de cerrar sesión y borrar el dispositivo. Si falla (sin
 *  red, servidor dormido), se sigue con el logout igualmente: es una copia de
 *  seguridad, no un requisito para poder salir. NUNCA rechaza: el llamador
 *  (`profile/page.tsx`) espera `mutateAsync()` y luego navega a /login.
 *  Devuelve el uid capturado ANTES de que nada lo borre. */
export async function performLogout(flushBudgetMs: number = LOGOUT_FLUSH_BUDGET_MS): Promise<string | null> {
  const uid = cachedActivityUid();
  const flush = Promise.allSettled([flushActivities(), flushUserState()]);
  // Si el backend se cuelga, el logout no espera: lo pendiente queda en las colas persistidas.
  await Promise.race([flush, new Promise<void>((resolve) => setTimeout(resolve, flushBudgetMs))]);
  await requestLogout();
  return uid;
}

let sessionExpiredHandled = false;

/** Un 401 que llega hasta aquí ya pasó por el refresh del BFF: la sesión está
 *  caída. Una sola vez por carga de página (varias queries fallan a la vez):
 *  borra las cookies y va a /login?reason=expired con una carga completa. NO
 *  borra los datos locales (borrador del entreno en curso, colas): el dueño
 *  puede volver a entrar; si entra otra cuenta, `claimDeviceOwner` los purga. */
export async function handleSessionExpired(
  qc: { clear: () => void },
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  if (typeof window === "undefined" || sessionExpiredHandled) return;
  if (window.location.pathname.startsWith("/login")) return;
  sessionExpiredHandled = true;
  await requestLogout();
  qc.clear();
  resetUserStateQueue();
  resetActivityUid();
  navigate("/login?reason=expired");
}

/** Handler de errores de React Query: solo un 401 definitivo cierra la sesión
 *  (un 503/5xx transitorio del BFF no debe desloguear ni borrar nada). */
export function handleQueryError(
  qc: { clear: () => void },
  err: unknown,
  navigate?: (url: string) => void,
): void {
  if (isUnauthorized(err)) void handleSessionExpired(qc, navigate);
}

/** Solo para tests. */
export function resetSessionExpiredGuard(): void {
  sessionExpiredHandled = false;
}

/** Limpieza del dispositivo tras un logout con éxito, y a /login. ANTES de
 *  `clearDeviceState`: cancela timers/listeners de la cola de user-state para
 *  que un reintento ya agendado no se dispare con las cookies de la SIGUIENTE
 *  cuenta. */
export function finishLogout(
  uid: string | null,
  navigate: (url: string) => void = (url) => window.location.replace(url),
): void {
  // Cierre a propósito (F15): un 401 que llegue ahora es del propio cierre, no una sesión
  // caducada, así que no se va a /login?reason=expired ni se avisa de «Sesión caducada».
  sessionExpiredHandled = true;
  resetUserStateQueue();
  clearDeviceState(uid);
  resetActivityUid(); // que nada se encole a nombre del usuario saliente
  void clearPageCopies();
  // Carga completa de /login: la caché de React Query muere con la página. Antes se vaciaba
  // aquí (`qc.clear()`) con las vistas aún montadas, y volvían a pedir /me, /me/profile y
  // /coach/safety, que ya daban 401.
  navigate("/login");
}

/** Borra las copias de las pantallas que guarda el service worker (F5): en un móvil compartido,
 * el siguiente no abre sin red el armazón de la cuenta anterior. */
async function clearPageCopies(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    for (const name of await caches.keys()) if (name.startsWith("flp-pages-")) await caches.delete(name);
  } catch { /* sin Cache Storage: nada que borrar */ }
}

export function useLogout() {
  return useMutation({
    mutationFn: () => performLogout(),
    onSuccess: (uid) => finishLogout(uid),
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


/* --- Tendencia de peso y check-in diario (coach, fase 5) --- */

export function useTrend(enabled = true) {
  return useQuery<Trend>({
    queryKey: ["trend"],
    queryFn: async () => trend.parse(await getJson("/api/proxy/coach/trend")),
    enabled,
  });
}

export function useCheckin() {
  return useQuery<CheckinState>({
    queryKey: ["checkin"],
    queryFn: async () => checkinState.parse(await getJson("/api/proxy/coach/checkin")),
  });
}

/** El servidor rechaza con `code` (`weight_targets_blocked`) y `fields` lo que `no_weight_targets`
 * no deja guardar, o con 400 y un objeto de errores por campo. */
export class CheckinError extends Error {
  status: number;
  code: string;
  fields: string[];
  errors: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    const code = typeof body.code === "string" ? body.code : "";
    super(code || String(status));
    this.status = status;
    this.code = code;
    this.fields = Array.isArray(body.fields) ? (body.fields as string[]) : [];
    this.errors = body;
  }
}

export function useSaveCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/proxy/coach/checkin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new CheckinError(res.status, data ?? {});
      return checkinResult.parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["biometrics"] });
      invalidateCoach(qc);
    },
  });
}
