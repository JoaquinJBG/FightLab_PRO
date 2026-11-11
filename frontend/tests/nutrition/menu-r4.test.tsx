import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import MenuPage from "@/app/(shell)/nutrition/menu/page";
import type { Menu } from "@/lib/menu";
import { CATALOGS, mockApi, renderApp } from "../support/app";
import { IMPORTED_MENU, importedState } from "../support/menu-f12";

// Ronda 4 de la prueba en móvil: R4-1 (un menú de «tu IA» sin días válidos sustituía al bueno y el
// alimento que no está en la tabla no se marcaba) y R4-2 («Preparar otro menú» no enseñaba el
// menú recién hecho). Datos inventados.

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => nav.replace.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const UNKNOWN = "chuletón de buey a la brasa";
const check = { kcal: "under" as const, protein_g: "ok" as const, fat_g: "ok" as const, fibre_g: "ok" as const };
const rejected = [
  { date: "2026-11-18", check, unknown: [UNKNOWN], repeats: false, blocking: [], empty: false, missing: [] },
  { date: "2026-11-19", check, unknown: [], repeats: false, blocking: [], empty: false, missing: [] },
];
const routes = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  "/api/proxy/coach/menu": { body: importedState() },
  "/api/proxy/coach/products": { body: { products: [] } },
  "/api/proxy/coach/tickets": { body: { enabled: false, max_upload_mb: 2, tickets: [] } },
  ...extra,
});

async function paste(text = '{"schema": 1, "days": []}') {
  fireEvent.change(await screen.findByTestId("menu-ai-paste"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("menu-ai-save"));
}

describe.each(["es", "en"] as const)("R4-1 menú de tu IA (%s)", (locale) => {
  const cat = CATALOGS[locale].menu;

  it("sin ningún día válido no se guarda nada ni se pregunta si sustituir, con el motivo de cada día", async () => {
    mockApi(routes({
      "/api/proxy/coach/menu/paste": { status: 422, body: { code: "no_valid_days", detail: "x", info: "2026-11-18", params: { days: 2 }, rejected } },
    }));
    renderApp(<MenuPage />, locale);
    await paste();
    const error = await screen.findByTestId("menu-ai-error");
    expect(error.dataset.code).toBe("no_valid_days");
    expect(error.textContent).toContain(cat.ai.errors.no_valid_days.replace("{days}", "2"));
    const days = within(error).getAllByTestId("menu-rejected-day");
    expect(days.map((d) => d.dataset.date)).toEqual(["2026-11-18", "2026-11-19"]);
    // El motivo nombra el alimento que no está en la tabla
    expect(days[0].textContent).toContain(UNKNOWN);
    expect(days[0].textContent).toContain(cat.rejected.unknown.split(":")[0]);
    expect(screen.queryByTestId("menu-ai-confirm")).toBeNull();
  });

  it("«¿Lo sustituyes?» dice cuántos días válidos tienen el menú guardado y el nuevo", async () => {
    mockApi(routes({
      "/api/proxy/coach/menu/paste": {
        status: 409,
        body: { code: "start_taken", detail: "x", info: "2026-11-18", params: { old_ok: 2, old_days: 2, new_ok: 1, new_days: 2 } },
      },
    }));
    renderApp(<MenuPage />, locale);
    await paste();
    const confirm = await screen.findByTestId("menu-ai-confirm");
    expect(confirm.textContent).toContain(
      cat.ai.startTakenCounts.replace("{old}", "2").replace("{oldDays}", "2").replace("{new}", "1").replace("{newDays}", "2"),
    );
  });

  it("guardado con días que no cuadran: dice que no se han guardado y por qué", async () => {
    const menu = { ...IMPORTED_MENU, source: "user_ai" as const, origin: "user_ai" as const };
    mockApi(routes({
      "/api/proxy/coach/menu/paste": {
        status: 201,
        body: {
          summary: { menu_id: "ia-2026-11-17", title: "Menú inventado", start: "2026-11-17", end: "2026-11-17", days: 1, dishes: 3, batch_sessions: 0, shopping_items: 0, source: "user_ai" },
          replaced: false, kept_checks: 0, checked: true, days_ok: 1, days_failing: ["2026-11-18"], rejected: [rejected[0]], menu,
        },
      },
    }));
    renderApp(<MenuPage />, locale);
    await paste();
    const done = await screen.findByTestId("menu-ai-done");
    expect(done.textContent).toContain(cat.ai.failing.split("{ok}")[0]);
    expect(within(done).getByTestId("menu-rejected-day").textContent).toContain(UNKNOWN);
  });

  it("un alimento que no está en la tabla sale marcado en el día", async () => {
    const day = IMPORTED_MENU.days[0];
    const meal = day.meals[0];
    const dish = { ...meal.dishes[0], items: [...meal.dishes[0].items, { name: UNKNOWN, amount: 247, unit: "g" as const, known: false, product: false, url: null }] };
    const menu: Menu = { ...IMPORTED_MENU, days: [{ ...day, meals: [{ ...meal, dishes: [dish] }] }, ...IMPORTED_MENU.days.slice(1)] };
    mockApi(routes({ "/api/proxy/coach/menu": { body: importedState({ menu }) } }));
    renderApp(<MenuPage />, locale);
    const marked = await screen.findByTestId("menu-item-unknown");
    expect(marked.closest("li")!.textContent).toContain(UNKNOWN);
    expect(marked.textContent).toContain(cat.unknownFood);
    expect(screen.getAllByTestId("menu-item-unknown")).toHaveLength(1);
  });
});

describe("R4-2 «Preparar otro menú»", () => {
  it("enseña el menú recién creado (por su id), no el que empieza más tarde", async () => {
    const created = { ...IMPORTED_MENU, id: 42, source: "generated" as const, origin: "auto" as const };
    mockApi(routes({
      "/api/proxy/coach/menu": (init) => (init?.method === "POST" ? { status: 201, body: created } : { body: importedState() }),
    }));
    renderApp(<MenuPage />, "es");
    fireEvent.click(await screen.findByRole("button", { name: CATALOGS.es.menu.form.regenerate }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/nutrition/menu?id=42"));
  });
});
