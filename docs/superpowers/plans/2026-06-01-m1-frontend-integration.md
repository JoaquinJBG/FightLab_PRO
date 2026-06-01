# M1 Frontend ↔ Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Next.js PWA to the Django API so a user can register, verify email, log in (JWT in httpOnly cookies via a BFF), and record/see **real biometrics** — replacing the sample data.

**Architecture:** Next.js App Router acts as a **BFF**: the browser only talks to Next route handlers, which proxy to Django (`DJANGO_API_URL`) and custody the JWT in httpOnly cookies. Client pages use **TanStack Query** + **Zod** to call the BFF (never Django directly). A generic authenticated proxy refreshes the access token on 401. Middleware guards the app shell.

**Tech Stack:** Next.js 16 (App Router) route handlers, `@tanstack/react-query`, `zod`, httpOnly cookies (`next/headers`).

**Spec:** [`../specs/2026-06-01-m1-core-auth-design.md`](../specs/2026-06-01-m1-core-auth-design.md)

---

## Dev runtime (already set up by the controller)

- **Backend** (Django) runs at `http://127.0.0.1:8001` (port 8000 is taken by another process). API base: `http://127.0.0.1:8001/api/v1`.
- **Postgres** runs in Docker on `localhost:5432`.
- **Frontend** dev server on `localhost:3000`, exposed to the phone via a cloudflared HTTPS tunnel.
- Email verification in dev prints to the **backend console** (`/tmp/flp_backend.log`): the link is `${FRONTEND_URL}/verify-email?token=...`. There is no real email send.

Run frontend commands from `frontend/` using pnpm. The Next dev server hot-reloads.

## File structure

```
frontend/
├── .env.local                         # CREATE — DJANGO_API_URL (gitignored)
├── lib/
│   ├── cookies.ts                     # CREATE — cookie names + set/clear helpers
│   ├── api.ts                         # CREATE — server-side fetch to Django
│   ├── schemas.ts                     # CREATE — Zod schemas + types
│   ├── hooks.ts                       # CREATE — TanStack Query hooks (client)
│   └── query-provider.tsx             # CREATE — QueryClientProvider (client)
├── app/
│   ├── api/
│   │   ├── auth/register/route.ts      # CREATE
│   │   ├── auth/verify-email/route.ts  # CREATE
│   │   ├── auth/login/route.ts         # CREATE
│   │   ├── auth/logout/route.ts        # CREATE
│   │   └── proxy/[...path]/route.ts    # CREATE — authenticated proxy + refresh
│   ├── layout.tsx                      # MODIFY — wrap in QueryProvider
│   ├── login/page.tsx                  # MODIFY — functional form
│   ├── register/page.tsx               # CREATE
│   ├── verify-email/page.tsx           # CREATE
│   └── (shell)/
│       ├── dashboard/page.tsx          # MODIFY — real data
│       ├── biometrics/new/page.tsx     # CREATE — entry form
│       └── profile/page.tsx            # MODIFY — real profile
└── middleware.ts                       # CREATE — guard /(shell) routes
```

---

## Task 1: Dependencies and environment

**Files:** Create `frontend/.env.local`; modify `frontend/package.json` (via pnpm add).

- [ ] **Step 1: Install deps**

Run (from `frontend/`): `pnpm add @tanstack/react-query zod`
Expected: both added to `dependencies`.

- [ ] **Step 2: Create `frontend/.env.local`**

```dotenv
# URL del backend Django para el BFF (server-side). Dev: backend en 8001.
DJANGO_API_URL=http://127.0.0.1:8001/api/v1
```

(create-next-app's `.gitignore` already ignores `.env*`, so this is not committed.)

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "build: añade tanstack query y zod al frontend"
```

---

## Task 2: Cookie helpers and server API client

**Files:** Create `frontend/lib/cookies.ts`, `frontend/lib/api.ts`.

- [ ] **Step 1: `lib/cookies.ts`**

```ts
import { cookies } from "next/headers";

export const ACCESS = "fl_access";
export const REFRESH = "fl_refresh";

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function setAuthCookies(access: string, refresh: string) {
  const jar = await cookies();
  jar.set(ACCESS, access, { ...base, maxAge: 60 * 15 });
  jar.set(REFRESH, refresh, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export async function setAccessCookie(access: string) {
  const jar = await cookies();
  jar.set(ACCESS, access, { ...base, maxAge: 60 * 15 });
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

export async function getAccess() {
  return (await cookies()).get(ACCESS)?.value ?? null;
}
export async function getRefresh() {
  return (await cookies()).get(REFRESH)?.value ?? null;
}
```

- [ ] **Step 2: `lib/api.ts`**

```ts
const BASE = process.env.DJANGO_API_URL ?? "http://127.0.0.1:8001/api/v1";

export type ApiResult = { status: number; data: unknown };

export async function djangoFetch(
  path: string,
  opts: { method?: string; body?: unknown; access?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.access) headers.Authorization = `Bearer ${opts.access}`;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/cookies.ts frontend/lib/api.ts
git commit -m "feat: helpers de cookies httpOnly y cliente server hacia Django"
```

---

## Task 3: BFF auth route handlers

**Files:** Create `frontend/app/api/auth/{register,verify-email,login,logout}/route.ts`.

- [ ] **Step 1: register**

`frontend/app/api/auth/register/route.ts`:
```ts
import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";

export async function POST(req: Request) {
  const body = await req.json();
  const r = await djangoFetch("/auth/register", { method: "POST", body });
  return NextResponse.json(r.data ?? {}, { status: r.status });
}
```

- [ ] **Step 2: verify-email**

`frontend/app/api/auth/verify-email/route.ts`:
```ts
import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";

export async function POST(req: Request) {
  const body = await req.json();
  const r = await djangoFetch("/auth/verify-email", { method: "POST", body });
  return NextResponse.json(r.data ?? {}, { status: r.status });
}
```

- [ ] **Step 3: login**

`frontend/app/api/auth/login/route.ts`:
```ts
import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { setAuthCookies } from "@/lib/cookies";

export async function POST(req: Request) {
  const body = await req.json();
  const r = await djangoFetch("/auth/login", { method: "POST", body });
  if (r.status === 200 && r.data && typeof r.data === "object") {
    const { access, refresh } = r.data as { access: string; refresh: string };
    await setAuthCookies(access, refresh);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(r.data ?? { detail: "Login fallido" }, { status: r.status || 401 });
}
```

- [ ] **Step 4: logout**

`frontend/app/api/auth/logout/route.ts`:
```ts
import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { getAccess, getRefresh, clearAuthCookies } from "@/lib/cookies";

export async function POST() {
  const refresh = await getRefresh();
  const access = await getAccess();
  if (refresh) {
    await djangoFetch("/auth/logout", { method: "POST", body: { refresh }, access });
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/auth
git commit -m "feat: route handlers BFF de auth (register, verify, login, logout)"
```

---

## Task 4: Authenticated proxy with token refresh

**Files:** Create `frontend/app/api/proxy/[...path]/route.ts`.

- [ ] **Step 1: Implement the proxy**

`frontend/app/api/proxy/[...path]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import {
  getAccess, getRefresh, setAuthCookies, setAccessCookie, clearAuthCookies,
} from "@/lib/cookies";

async function handle(req: Request, path: string[]) {
  const target = "/" + path.join("/");
  const method = req.method;
  let body: unknown = undefined;
  if (method !== "GET" && method !== "DELETE") {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  }

  let access = await getAccess();
  let r = await djangoFetch(target, { method, body, access });

  if (r.status === 401) {
    const refresh = await getRefresh();
    if (!refresh) {
      await clearAuthCookies();
      return NextResponse.json({ detail: "No autenticado" }, { status: 401 });
    }
    const ref = await djangoFetch("/auth/refresh", { method: "POST", body: { refresh } });
    if (ref.status === 200 && ref.data && typeof ref.data === "object") {
      const d = ref.data as { access: string; refresh?: string };
      if (d.refresh) await setAuthCookies(d.access, d.refresh);
      else await setAccessCookie(d.access);
      access = d.access;
      r = await djangoFetch(target, { method, body, access });
    } else {
      await clearAuthCookies();
      return NextResponse.json({ detail: "Sesión expirada" }, { status: 401 });
    }
  }

  return NextResponse.json(r.data ?? {}, { status: r.status });
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).path); }
export async function POST(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).path); }
export async function PATCH(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).path); }
export async function DELETE(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).path); }
```

So the client calls e.g. `GET /api/proxy/me/biometrics` → Django `GET /me/biometrics` with the access cookie.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/api/proxy
git commit -m "feat: proxy autenticado del BFF con refresh de token"
```

---

## Task 5: Route guard middleware

**Files:** Create `frontend/middleware.ts`.

- [ ] **Step 1: Implement**

`frontend/middleware.ts`:
```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/training", "/nutrition", "/coach", "/profile", "/biometrics"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!needsAuth) return NextResponse.next();
  const hasSession = req.cookies.has("fl_refresh");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/training/:path*", "/nutrition/:path*", "/coach/:path*", "/profile/:path*", "/biometrics/:path*"],
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/middleware.ts
git commit -m "feat: middleware que protege las rutas del shell"
```

---

## Task 6: Zod schemas, query provider, and hooks

**Files:** Create `frontend/lib/schemas.ts`, `frontend/lib/query-provider.tsx`, `frontend/lib/hooks.ts`; modify `frontend/app/layout.tsx`.

- [ ] **Step 1: `lib/schemas.ts`**

```ts
import { z } from "zod";

export const credentials = z.object({
  email: z.string().email("Email no válido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});
export type Credentials = z.infer<typeof credentials>;

export const biometrics = z.object({
  id: z.number(),
  weight_kg: z.string().nullable(),
  body_fat_pct: z.string().nullable(),
  resting_heart_rate: z.number().nullable(),
  sleep_quality_score: z.number().nullable(),
  hrv_ms: z.number().nullable(),
  timestamp: z.string(),
  source: z.string(),
});
export type Biometrics = z.infer<typeof biometrics>;

export const profile = z.object({
  date_of_birth: z.string().nullable(),
  gender: z.string().nullable(),
  height_cm: z.number().nullable(),
  dominant_stance: z.string().nullable(),
  preferred_units: z.string(),
  timezone: z.string(),
});
export type Profile = z.infer<typeof profile>;

export const me = z.object({
  id: z.number(),
  email: z.string(),
  role: z.string(),
  is_email_verified: z.boolean(),
});
export type Me = z.infer<typeof me>;
```

- [ ] **Step 2: `lib/query-provider.tsx`**

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 3: `lib/hooks.ts`**

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { biometrics, me, profile, type Biometrics, type Me, type Profile } from "./schemas";
import { z } from "zod";

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
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : String(res.status));
  return data;
}

export function useMe() {
  return useQuery<Me>({ queryKey: ["me"], queryFn: async () => me.parse(await getJson("/api/proxy/me")) });
}
export function useProfile() {
  return useQuery<Profile>({ queryKey: ["profile"], queryFn: async () => profile.parse(await getJson("/api/proxy/me/profile")) });
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
    mutationFn: (payload: Record<string, unknown>) => sendJson("/api/proxy/me/biometrics", "POST", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["biometrics"] }),
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson("/api/auth/logout", "POST"),
    onSuccess: () => qc.clear(),
  });
}
```

- [ ] **Step 4: Wrap layout in the provider**

In `frontend/app/layout.tsx`, import `QueryProvider` from `@/lib/query-provider` and wrap `{children}`:
```tsx
import { QueryProvider } from "@/lib/query-provider";
// ...
      <body className="min-h-full">
        <BackgroundFx />
        <QueryProvider>{children}</QueryProvider>
        <ServiceWorkerRegister />
      </body>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib frontend/app/layout.tsx
git commit -m "feat: schemas Zod, provider de TanStack Query y hooks de datos"
```

---

## Task 7: Functional auth pages (login, register, verify-email)

**Files:** Modify `frontend/app/login/page.tsx`; create `frontend/app/register/page.tsx`, `frontend/app/verify-email/page.tsx`.

- [ ] **Step 1: Login (client form)**

Replace `frontend/app/login/page.tsx` with a client component that posts to `/api/auth/login` and on success `router.push("/dashboard")`. Keep the existing visual style (wordmark, `.field`, `.btn .btn-primary`). Full code:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";
import { credentials } from "@/lib/schemas";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setLoading(false);
    if (res.ok) router.push("/dashboard");
    else setError("Credenciales incorrectas o cuenta sin verificar");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 safe-top safe-bottom">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="glass glow mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
            <span className="font-display text-2xl font-bold neon-text">FL</span>
          </div>
          <h1 className="t-display text-3xl text-ink">FIGHTLAB <span className="neon-text">PRO</span></h1>
          <p className="t-body mt-2 text-muted">Rendimiento de combate, medido y entrenado.</p>
        </div>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Email</span>
            <input type="email" inputMode="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" className="field px-4 py-3.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Contraseña</span>
            <input type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="field px-4 py-3.5 text-sm" />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-60">
            {loading ? "Entrando…" : "Entrar"}<ArrowUpRight className="h-4 w-4" />
          </button>
        </form>
        <p className="t-body mt-6 text-center text-xs text-muted">
          ¿No tienes cuenta? <Link href="/register" className="text-neon">Crear cuenta</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register**

`frontend/app/register/page.tsx` (client): posts to `/api/auth/register`; on 201 shows "revisa tu email" message. Full code:
```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { credentials } from "@/lib/schemas";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setLoading(false);
    if (res.status === 201) setDone(true);
    else { const d = await res.json().catch(() => ({})); setError(typeof d?.detail === "string" ? d.detail : "No se pudo registrar"); }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <h1 className="t-display text-3xl text-ink">Crear <span className="neon-text">cuenta</span></h1>
      {done ? (
        <div className="glass neon-edge mt-6 p-6">
          <p className="t-title text-ink">Revisa tu email</p>
          <p className="t-body mt-2 text-muted">Te enviamos un enlace de verificación. En desarrollo aparece en la consola del backend.</p>
          <Link href="/login" className="btn btn-tonal mt-5">Ir a iniciar sesión</Link>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Email</span>
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com" className="field px-4 py-3.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Contraseña</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres" className="field px-4 py-3.5 text-sm" />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-60">
            {loading ? "Creando…" : "Crear cuenta"}
          </button>
          <p className="t-body mt-3 text-center text-xs text-muted">
            ¿Ya tienes cuenta? <Link href="/login" className="text-neon">Entrar</Link>
          </p>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify email**

`frontend/app/verify-email/page.tsx` (client): reads `?token`, posts to `/api/auth/verify-email`, shows result. Full code:
```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!token) { setState("error"); return; }
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then((r) => setState(r.ok ? "ok" : "error")).catch(() => setState("error"));
  }, [token]);

  return (
    <div className="glass neon-edge mt-6 p-6 text-center">
      {state === "loading" && <p className="t-body text-muted">Verificando…</p>}
      {state === "ok" && (
        <>
          <p className="t-title text-ink">¡Email verificado! ✅</p>
          <Link href="/login" className="btn btn-primary mt-5">Iniciar sesión</Link>
        </>
      )}
      {state === "error" && (
        <>
          <p className="t-title text-ink">Enlace no válido o caducado</p>
          <Link href="/register" className="btn btn-tonal mt-5">Volver a registrarme</Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <h1 className="t-display text-3xl text-ink">Verificación</h1>
      <Suspense fallback={<p className="t-body mt-6 text-muted">Cargando…</p>}>
        <Verify />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 4: Verify the flow runs**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login` → 200; same for `/register`, `/verify-email`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/login frontend/app/register frontend/app/verify-email
git commit -m "feat: páginas funcionales de login, registro y verificación"
```

---

## Task 8: Biometrics — entry form wired to the API

**Files:** Create `frontend/app/(shell)/biometrics/new/page.tsx`.

- [ ] **Step 1: Entry form**

`frontend/app/(shell)/biometrics/new/page.tsx` (client) using `useCreateBiometrics`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateBiometrics } from "@/lib/hooks";

const fields = [
  { key: "weight_kg", label: "Peso (kg)", step: "0.1", unit: "kg" },
  { key: "body_fat_pct", label: "% Grasa", step: "0.1", unit: "%" },
  { key: "resting_heart_rate", label: "FC reposo", step: "1", unit: "bpm" },
  { key: "sleep_quality_score", label: "Sueño (1-10)", step: "1", unit: "/10" },
  { key: "hrv_ms", label: "HRV", step: "1", unit: "ms" },
] as const;

export default function NewBiometricsPage() {
  const router = useRouter();
  const create = useCreateBiometrics();
  const [vals, setVals] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const v = vals[f.key];
      if (v !== undefined && v !== "") {
        payload[f.key] = f.key === "weight_kg" || f.key === "body_fat_pct" ? v : Number(v);
      }
    }
    try {
      await create.mutateAsync(payload);
      router.push("/dashboard");
    } catch {
      /* el error se muestra abajo via create.isError */
    }
  }

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">Nueva <span className="neon-text">medición</span></h1>
      <p className="t-body mt-1 text-muted">Rellena solo lo que quieras registrar hoy.</p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
        {fields.map((f) => (
          <label key={f.key} className="glass flex items-center justify-between gap-3 p-3.5">
            <span className="t-label text-ink">{f.label}</span>
            <span className="flex items-center gap-2">
              <input
                type="number" step={f.step} inputMode="decimal"
                value={vals[f.key] ?? ""}
                onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                className="field w-24 px-3 py-2 text-right text-sm"
              />
              <span className="t-label w-8 text-muted">{f.unit}</span>
            </span>
          </label>
        ))}
        {create.isError && <p className="text-xs text-bad">{(create.error as Error).message}</p>}
        <button type="submit" disabled={create.isPending} className="btn btn-primary mt-2 disabled:opacity-60">
          {create.isPending ? "Guardando…" : "Guardar medición"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "frontend/app/(shell)/biometrics"
git commit -m "feat: formulario de alta de biometría conectado a la API"
```

---

## Task 9: Dashboard and profile with real data

**Files:** Modify `frontend/app/(shell)/dashboard/page.tsx`, `frontend/app/(shell)/profile/page.tsx`.

- [ ] **Step 1: Make the dashboard a client component using real biometrics**

Convert `dashboard/page.tsx` to `"use client"` and derive the metrics from `useBiometrics()` and `useMe()`. Keep the existing visual components (ReadinessRing, Sparkline, AcwrBar, MetricCard, weekly bars) but feed them real values: latest entry for weight/sleep/rhr/hrv, the weight spark from the last 7 entries' `weight_kg`, and a placeholder ACWR/readiness (those come from M2 — show "—" or a neutral state when no training data). Show an empty-state CTA ("Registra tu primera medición") linking to `/biometrics/new` when the list is empty, and a loading skeleton while `isLoading`. The "Registrar biometría" CTA links to `/biometrics/new`. Replace the hardcoded `data` object accordingly.

Concretely: `const { data: logs = [], isLoading } = useBiometrics();` then `const latest = logs[0];` (API returns newest first). Map `latest.weight_kg` (string→Number), `latest.sleep_quality_score`, `latest.resting_heart_rate`, `latest.hrv_ms`. For the sparkline use `logs.slice(0, 7).reverse().map(l => Number(l.weight_kg)).filter(Number.isFinite)`. For readiness/ACWR (no training data yet in M1) render a muted "Próximamente con M2" note instead of fake numbers. Header name from `useMe()` email local-part. Add a logout button (use `useLogout()` then `router.push("/login")`).

- [ ] **Step 2: Profile real data**

Replace `profile/page.tsx` placeholder with a client component using `useProfile()` and `useMe()` to show email, role, height, stance, units, timezone (read-only list for now), plus a logout button. Keep the glass styling.

- [ ] **Step 3: Verify compile**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard` → 200 (redirects to /login via middleware if no cookie — 307 is also acceptable).

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(shell)/dashboard/page.tsx" "frontend/app/(shell)/profile/page.tsx"
git commit -m "feat: dashboard y perfil con datos reales de la API"
```

---

## Task 10: End-to-end verification with real data

- [ ] **Step 1: Register a user via the UI** (or curl): `POST /api/auth/register` with your email + password.

- [ ] **Step 2: Grab the verification link** from the backend console log (`tail -n 40 /tmp/flp_backend.log`), open `${FRONTEND_URL}/verify-email?token=...` (the tunnel URL on the phone, or localhost on desktop).

- [ ] **Step 3: Log in** at `/login`. Confirm you land on `/dashboard` and a `fl_refresh` cookie is set.

- [ ] **Step 4: Add a biometrics entry** at `/biometrics/new` (e.g. weight 78.4, sleep 8). Confirm it appears on the dashboard (weight card + sparkline update) and persists after reload.

- [ ] **Step 5: Confirm isolation & logout**: log out (clears cookies, redirects to login); protected routes redirect to `/login` when logged out.

## Self-review checklist (kept for the implementer)

- **Spec coverage:** BFF + httpOnly cookies ✓ (Tasks 2-4), register/verify/login/logout ✓ (Tasks 3,7), token refresh ✓ (Task 4), route protection ✓ (Task 5), TanStack Query + Zod ✓ (Task 6), profile + biometrics real data ✓ (Tasks 8,9), per-user data enforced by the backend. 
- **Out of scope (correct):** readiness/ACWR real values (need M2 training data — shown as "próximamente"), password reset, PWA offline.
- **Naming consistency:** cookie names `fl_access`/`fl_refresh`, hooks `useMe/useProfile/useBiometrics/useCreateBiometrics/useLogout`, proxy base `/api/proxy/...`, BFF auth `/api/auth/...` — used identically across tasks.

## Notes for the implementer

- The backend's `verify-email` is **POST {token}** (not GET) and `logout` is `AllowAny` — the BFF handlers above already match that.
- simplejwt rotates refresh tokens, so `/auth/refresh` returns a new `refresh` too; the proxy updates both cookies (Task 4).
- Don't call Django from client components — always go through `/api/proxy/...` or `/api/auth/...` so the token stays in httpOnly cookies.
