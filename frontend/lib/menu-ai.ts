"use client";

// Menús con la IA del propio usuario a coste 0 (fase 14). FightLab no llama a ninguna IA:
//
// - Vía B: la skill de Claude Code del PC del usuario, con un token personal que se crea en
//   Perfil → Mi IA (`useMenuTokens`). El token se ve una sola vez.
// - Vía C (móvil): «Prepararlo con mi IA» copia un texto con las instrucciones y los datos del
//   menú (`buildPrompt`, el mismo contexto que descarga la skill) para pegarlo en claude.ai u otra
//   IA; el JSON que devuelve se pega en la app (`usePasteMenu`) y pasa por el importador y el motor.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { importResponse, MenuError, type MealKey } from "./menu";

const BASE = "/api/proxy/coach";

/** Lo que enseña la app del origen de un menú: la IA del usuario, el generador sin IA o un
 * archivo importado. */
export type MenuOrigin = "user_ai" | "auto" | "import";

export function menuOrigin(source: string): MenuOrigin {
  if (source === "user_ai") return "user_ai";
  return source === "generated" ? "auto" : "import";
}

// ---------------------------------------------------------------- C: copiar el contexto

export const menuContext = z
  .object({
    context_version: z.number(),
    lang: z.string(),
    request: z.object({
      start: z.string(),
      end: z.string(),
      days: z.number(),
      meals: z.array(z.string()),
      tupper_meals: z.array(z.string()),
      id: z.string(),
    }).passthrough(),
    instructions: z.string(),
  })
  .passthrough();
export type MenuContext = z.infer<typeof menuContext>;

/** El texto que se pega en la IA: las instrucciones y, debajo, los datos en JSON (sin repetir
 * las instrucciones dentro). */
export function buildPrompt(ctx: MenuContext, dataTitle: string): string {
  const { instructions, ...data } = ctx;
  return `${instructions}\n\n${dataTitle}\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
}

export type ContextParams = { days: number; meals: MealKey[]; tupper: MealKey[]; start?: string };

export function contextUrl(p: ContextParams): string {
  const q = new URLSearchParams({ days: String(p.days), meals: p.meals.join(",") });
  if (p.tupper.length) q.set("tupper", p.tupper.join(","));
  if (p.start) q.set("start", p.start);
  return `${BASE}/menu/context?${q.toString()}`;
}

export async function fetchContext(p: ContextParams): Promise<MenuContext> {
  const res = await fetch(contextUrl(p), { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new MenuError(typeof data?.code === "string" ? data.code : String(res.status), typeof data?.detail === "string" ? data.detail : "", data);
  }
  return menuContext.parse(data);
}

/** Copia un texto que todavía se está preparando. Safari solo deja escribir en el portapapeles
 * dentro del toque del usuario: con `ClipboardItem` se le pasa la promesa en ese momento. Sin
 * él, se espera el texto y se usa `writeText`. Devuelve el texto (para enseñarlo si falla). */
export async function copyLater(text: Promise<string>): Promise<{ text: string; copied: boolean }> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clip && typeof clip.write === "function" && typeof ClipboardItem !== "undefined") {
    const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
    try {
      await clip.write([new ClipboardItem({ "text/plain": blob })]);
      return { text: await text, copied: true };
    } catch {
      // sigue con writeText
    }
  }
  const value = await text;
  if (clip && typeof clip.writeText === "function") {
    try {
      await clip.writeText(value);
      return { text: value, copied: true };
    } catch {
      return { text: value, copied: false };
    }
  }
  return { text: value, copied: false };
}

// ---------------------------------------------------------------- C: pegar el JSON

export const pasteResponse = importResponse.extend({
  checked: z.boolean(),
  days_ok: z.number(),
  days_failing: z.array(z.string()),
});
export type PasteResponse = z.infer<typeof pasteResponse>;

/** Pega el JSON que devolvió la IA (el texto tal cual: el servidor quita las vallas ```json y lo
 * que haya alrededor). `start_taken` (409): otro menú empieza ese día; se repite con `replaceStart`. */
export function usePasteMenu() {
  const qc = useQueryClient();
  return useMutation<PasteResponse, MenuError, { text: string; replaceStart?: boolean }>({
    mutationFn: async ({ text, replaceStart }) => {
      if (!text.trim()) throw new MenuError("paste_empty", "");
      const res = await fetch(`${BASE}/menu/paste`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu: text, ...(replaceStart ? { replace_start: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new MenuError(typeof data?.code === "string" ? data.code : String(res.status), typeof data?.detail === "string" ? data.detail : "", data);
      }
      return pasteResponse.parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["menu"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/** Dónde falla el JSON, para enseñarlo junto al mensaje (`info` del servidor: «days.date»,
 * «2026-11-02: dish_id D9», «line 3, column 5: …»). */
export function errorInfo(error: MenuError | null): string | null {
  const data = error?.data as { info?: unknown } | null | undefined;
  return data && typeof data.info === "string" && data.info ? data.info : null;
}

// ---------------------------------------------------------------- B: tokens

export const menuToken = z.object({
  id: z.number(),
  name: z.string(),
  prefix: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  scope: z.array(z.string()),
});
export type MenuToken = z.infer<typeof menuToken>;
const tokenList = z.object({ tokens: z.array(menuToken), max: z.number() });
const createdToken = menuToken.extend({ token: z.string() });
export type CreatedToken = z.infer<typeof createdToken>;

async function call(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new MenuError(typeof data?.code === "string" ? data.code : String(res.status), typeof data?.detail === "string" ? data.detail : "", data);
  }
  return data;
}

export function useMenuTokens() {
  return useQuery({ queryKey: ["menu-tokens"], queryFn: async () => tokenList.parse(await call(`${BASE}/menu-tokens`)) });
}

export function useCreateMenuToken() {
  const qc = useQueryClient();
  return useMutation<CreatedToken, MenuError, string>({
    mutationFn: async (name) => createdToken.parse(await call(`${BASE}/menu-tokens`, "POST", { name })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu-tokens"] }),
  });
}

export function useRevokeMenuToken() {
  const qc = useQueryClient();
  return useMutation<unknown, MenuError, number>({
    mutationFn: async (id) => call(`${BASE}/menu-tokens/${id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu-tokens"] }),
  });
}

/** La dirección que usa la skill: la de la app, con la ruta para los tokens (`/api/ext`). */
export function skillApiUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/ext`;
}
