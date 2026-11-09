import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import MenuPage from "@/app/(shell)/nutrition/menu/page";
import BatchPage from "@/app/(shell)/nutrition/menu/batch/page";
import { CATALOGS, mockApi, renderApp } from "../support/app";
import { IMPORTED_MENU, importedState } from "../support/menu-f12";
import {
  EMPTY_CLOCK,
  elapsedSec,
  laneNow,
  lanes,
  pause,
  start,
  stepStatus,
  toggleDone,
  toggleTimer,
  timerLeft,
} from "@/lib/batch-timer";
import { filterByWeek } from "@/lib/menu";

// Fase 12: menús completos importados, sesión de batch a pantalla completa, lista de la compra por
// sección y formato con casillas, tickets e importar menús.

const params = { value: new URLSearchParams() };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => params.value,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  params.value = new URLSearchParams();
});

const TIMELINE = IMPORTED_MENU.batch_sessions[0].timeline;

describe("reloj de la sesión de batch", () => {
  it("cuenta sin las pausas y dice qué toca en cada aparato", () => {
    let c = start(EMPTY_CLOCK, 0);
    expect(elapsedSec(c, 5 * 60_000)).toBe(300);
    c = pause(c, 5 * 60_000);
    c = start(c, 15 * 60_000); // 10 min de pausa
    expect(elapsedSec(c, 20 * 60_000)).toBe(600);
    expect(stepStatus(TIMELINE[0], 0, c, 600)).toBe("late");
    expect(stepStatus(TIMELINE[1], 1, c, 600)).toBe("now");
    expect(stepStatus(TIMELINE[0], 0, toggleDone(c, 0), 600)).toBe("done");
    const byWhere = lanes(TIMELINE);
    expect(byWhere.map((l) => l.where)).toEqual(["hands", "pressure_cooker", "oven"]);
    const cooker = laneNow(byWhere[1], c, 600)!;
    expect(cooker.started).toBe(true);
    expect(cooker.left).toBe(40 * 60);
  });

  it("cada paso tiene su temporizador de su duración", () => {
    const c = toggleTimer(EMPTY_CLOCK, 1, TIMELINE[1], 1_000);
    expect(timerLeft(c, 1, 1_000)).toBe(40 * 60);
    expect(timerLeft(c, 1, 1_000 + 41 * 60_000)).toBe(0);
    expect(timerLeft(toggleTimer(c, 1, TIMELINE[1], 2_000), 1, 2_000)).toBeNull();
  });

  it("filtra la lista por semana (lo que no dice semana va siempre)", () => {
    const list = IMPORTED_MENU.shopping_list!;
    expect(filterByWeek(list, 2).map((s) => s.section)).toEqual(["Legumbres", "Pescadería"]);
    expect(filterByWeek(list, 0)).toHaveLength(3);
  });
});

describe.each(["es", "en"] as const)("menú importado (%s)", (locale) => {
  const cat = CATALOGS[locale].menu;

  it("pinta cabecera, nevera/congelador con su regla, víspera y comida libre", async () => {
    mockApi({
      "/api/proxy/coach/menu": { body: importedState() },
      "/api/proxy/coach/products": { body: { products: [] } },
      "/api/proxy/coach/tickets": { body: { enabled: false, max_upload_mb: 2, tickets: [] } },
    });
    renderApp(<MenuPage />, locale);
    const header = await screen.findByTestId("menu-header");
    expect(header.dataset.source).toBe("json");
    expect(header.textContent).toContain("Menú de prueba");
    expect(screen.queryAllByTestId("menu-target")).toHaveLength(0); // sin objetivos: no se inventan
    const storage = screen.getAllByTestId("meal-storage");
    expect(storage.map((s) => s.dataset.where)).toEqual(["fridge", "freezer"]);
    expect(storage[0].textContent).toBe(cat.day.storage.fridge);
    const chip = storage[0].parentElement!.querySelector('[data-testid="evidence-chip"]') as HTMLElement;
    expect(chip.dataset.variant).toBe("evidence");
    const eve = screen.getAllByTestId("day-eve");
    expect(eve[0].textContent).toContain("Remojar las lentejas");
    expect(eve[1].textContent).toContain("Lentejas con pollo");
    expect(screen.getByTestId("meal-free").textContent).toContain("650");
    expect(screen.getByTestId("menu-file-totals").textContent).toContain("2");
    // La sesión de batch con su enlace a pantalla completa.
    const session = screen.getByTestId("batch-session");
    expect(within(session).getByTestId("batch-open").getAttribute("href")).toBe("/nutrition/menu/batch?menu=9&session=0");
    expect(within(screen.getByTestId("batch-sessions")).getAllByTestId("evidence-chip").length).toBeGreaterThanOrEqual(4);
    // Tickets sin R2: se explica.
    expect((await screen.findByTestId("tickets-off")).textContent).toBe(cat.tickets.off);
    expect(screen.getByTestId("menu-picker")).toBeTruthy();
  });

  it("lista por sección y formato; tachar manda el nombre al servidor", async () => {
    const fetch = mockApi({
      "/api/proxy/coach/menu": { body: importedState() },
      "/api/proxy/coach/products": { body: { products: [] } },
      "/api/proxy/coach/tickets": { body: { enabled: true, max_upload_mb: 2, tickets: [] } },
      "/api/proxy/coach/menu/9/shopping": { body: { ...IMPORTED_MENU.shopping_list, checked: 2 } },
    });
    renderApp(<MenuPage />, locale);
    const list = await screen.findByTestId("shopping-list");
    expect(within(list).getAllByTestId("shopping-section").map((s) => s.dataset.section)).toEqual(["Carnicería", "Legumbres", "Pescadería"]);
    const lentils = within(list).getAllByTestId("shopping-item")[1];
    expect(lentils.textContent).toContain("bote de lentejas cocidas 400 g");
    expect(within(lentils).getByTestId("shopping-week").textContent).toBe(cat.shopping.weekTag.both);
    fireEvent.click(within(lentils).getByRole("checkbox"));
    await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => String(u).endsWith("/menu/9/shopping") && i?.method === "PUT")).toBe(true));
    const [, init] = fetch.mock.calls.find(([u, i]) => String(u).endsWith("/menu/9/shopping") && i?.method === "PUT")!;
    expect(JSON.parse(String(init!.body))).toEqual({ item: "lentejas, cocidas", checked: true });
    // Semana 2: solo lo de esa semana.
    fireEvent.click(within(list).getAllByTestId("shopping-week-tab")[2]);
    expect(within(list).getAllByTestId("shopping-section").map((s) => s.dataset.section)).toEqual(["Legumbres", "Pescadería"]);
  });

  it("importar: si otro menú empieza ese día, pide confirmar y repite con replace_start", async () => {
    let calls = 0;
    const fetch = mockApi({
      "/api/proxy/coach/menu": { body: importedState({ menu: null, menus: [] }) },
      "/api/proxy/coach/products": { body: { products: [] } },
      "/api/proxy/coach/menu/import": () => {
        calls += 1;
        return calls === 1
          ? { status: 409, body: { code: "start_taken", detail: "x" } }
          : { status: 201, body: { summary: { menu_id: "x", title: "Menú de prueba", start: "2026-11-02", end: "2026-11-04", days: 3, dishes: 1, batch_sessions: 1, shopping_items: 3, source: "json" }, replaced: false, kept_checks: 0, menu: IMPORTED_MENU } };
      },
    });
    renderApp(<MenuPage />, locale);
    const input = (await screen.findByTestId("menu-import-input")) as HTMLInputElement;
    const file = new File(['{"schema": 1}'], "menu.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    const confirm = await screen.findByTestId("menu-import-confirm");
    expect(confirm.textContent).toContain(cat.import.startTaken);
    fireEvent.click(within(confirm).getByRole("button"));
    const done = await screen.findByTestId("menu-import-done");
    expect(done.textContent).toContain("Menú de prueba");
    const posts = fetch.mock.calls.filter(([u]) => String(u).endsWith("/menu/import"));
    expect(posts).toHaveLength(2);
    expect((posts[1][1]!.body as FormData).get("replace_start")).toBe("true");
  });

  it("la sesión de batch a pantalla completa: carriles por aparato, reloj y temporizador por paso", async () => {
    params.value = new URLSearchParams("menu=9&session=0");
    mockApi({ "/api/proxy/coach/menu": { body: importedState() } });
    renderApp(<BatchPage />, locale);
    const screenEl = await screen.findByTestId("batch-screen");
    expect(screenEl.dataset.running).toBe("false");
    expect(screen.getAllByTestId("batch-lane").map((l) => l.dataset.where)).toEqual(["hands", "pressure_cooker", "oven"]);
    expect(screen.getAllByTestId("batch-lane")[1].textContent).toContain(cat.batch.appliances.pressure_cooker);
    expect(screen.getAllByTestId("batch-step")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("batch-start"));
    expect(screen.getByTestId("batch-screen").dataset.running).toBe("true");
    const stored = JSON.parse(localStorage.getItem("flp_batch_9_2026-11-01")!);
    expect(typeof stored.startedAt).toBe("number");
    const timer = screen.getAllByTestId("batch-step-timer")[1];
    expect(timer.textContent).toBe(cat.batchScreen.timer.replace("{minutes}", "40"));
    fireEvent.click(timer);
    expect(screen.getAllByTestId("batch-step-timer")[1].textContent).toMatch(/^\d\d:\d\d$/);
    fireEvent.click(within(screen.getAllByTestId("batch-step")[0]).getByRole("checkbox"));
    expect(screen.getAllByTestId("batch-step")[0].dataset.status).toBe("done");
  });
});
