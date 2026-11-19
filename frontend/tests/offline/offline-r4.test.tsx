import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import TodayPage from "@/app/(shell)/today/page";
import { ServiceWorkerRegister } from "@/app/sw-register";
import type { TodayState } from "@/lib/today";
import { CATALOGS, mockApi, renderApp } from "../support/app";

// Ronda 4 de la prueba en móvil: R4-3 (la página sin conexión salía en inglés con la cuenta en
// español) y R4-6 (sin conexión, «Movilidad» seguía en «Aún no» tras tocarla).

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

const navLang = Object.getOwnPropertyDescriptor(window.navigator, "language");
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => onlineManager.setOnline(true));
  if (navLang) Object.defineProperty(window.navigator, "language", navLang);
  else Reflect.deleteProperty(window.navigator, "language");
});

/* ------------------------------ R4-3: offline.html ------------------------------ */

const HTML = readFileSync(join(process.cwd(), "public", "offline.html"), "utf8");

/** Abre offline.html en el documento de jsdom y ejecuta su script, con el idioma del navegador. */
function openOffline(browser: string) {
  Object.defineProperty(window.navigator, "language", { value: browser, configurable: true });
  document.documentElement.lang = "es";
  document.body.innerHTML = HTML.split("<body>")[1].split("<script>")[0];
  const script = HTML.split("<script>")[1].split("</script>")[0];
  new Function(script)();
  return document.querySelector("h1")!.textContent;
}

describe("R4-3: la página sin conexión sale en el idioma de la app", () => {
  it("con la app en español y el navegador en inglés, en español", () => {
    localStorage.setItem("flp_lang", "es");
    expect(openOffline("en-US")).toBe("Sin conexión");
    expect(document.getElementById("retry")!.textContent).toBe("Reintentar");
  });

  it("con la app en inglés y el navegador en español, en inglés", () => {
    localStorage.setItem("flp_lang", "en");
    expect(openOffline("es-ES")).toBe("You're offline");
    expect(document.documentElement.lang).toBe("en");
  });

  it("sin idioma guardado, el del navegador", () => {
    expect(openOffline("en-GB")).toBe("You're offline");
  });

  it("la app guarda su idioma para esa página (la cookie es httpOnly)", () => {
    render(<ServiceWorkerRegister locale="es" />);
    expect(localStorage.getItem("flp_lang")).toBe("es");
  });

  it("el service worker cambia de versión para no servir la página vieja guardada", () => {
    expect(readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")).toContain('const VERSION = "v2"');
  });
});

/* ------------------------- R4-6: marcas sin conexión ------------------------- */

const URL = "/api/proxy/coach/today";
const DAY: TodayState = {
  date: "2026-10-29", today: "2026-10-29", weekday: "thu", plan: null, day_type: null, day_type_set: false,
  trained: null, mobility: null, weight_kg: null, weight_blocked: false, next_meal: null,
  menu: {
    id: 7, start_date: "2026-10-26",
    meals: [{ meal: "breakfast", free: false, tupper: false, dishes: ["Avena con yogur"], prep: [], eve: [], mark: null }],
  },
  cardio: {
    sessions: [],
    week: {
      start: "2026-10-26", minutes: 0, equivalent: 0, goal: 150, mma_minutes: 0, mma_convention: null,
      rule_key: "cardio-health/weekly-baseline-dose", grade: "strong",
      vigorous_rule_key: "cardio-health/0-10-effort-scale-and-talk-test-anchors", vigorous_grade: "moderate",
    },
    types: [{ key: "walk", vigorous: false }],
  },
};
const es = CATALOGS.es.today;

describe("R4-6: sin conexión la marca se ve al momento, con «pendiente»", () => {
  it("Movilidad pasa a «Sí» con el indicador de pendiente y se envía al volver la red", async () => {
    const sent: unknown[] = [];
    let current = DAY;
    mockApi({
      [URL]: (init) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          sent.push(body);
          current = { ...current, ...body };
        }
        return { body: current };
      },
      [`${URL}/meal`]: (init) => {
        const body = JSON.parse(String(init!.body));
        sent.push(body);
        current = { ...current, menu: { ...current.menu!, meals: current.menu!.meals.map((m) => ({ ...m, mark: { state: body.state, change: null } })) } };
        return { body: current };
      },
    });
    const { client } = renderApp(<TodayPage />);
    const toggle = await screen.findByTestId("toggle-mobility");
    expect(toggle.textContent).toContain(es.done.notYet);

    act(() => onlineManager.setOnline(false));
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId("toggle-mobility").textContent).toContain(`✓ ${es.done.yes}`));
    expect(screen.getByTestId("toggle-mobility").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("toggle-mobility-pending").textContent).toBe(es.done.pending);
    expect(sent).toEqual([]);

    // La comida del menú, igual
    fireEvent.click(screen.getByTestId("meal-breakfast-done"));
    await waitFor(() => expect(screen.getByTestId("meal-breakfast-done").getAttribute("aria-pressed")).toBe("true"));

    await act(async () => {
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
    });
    await waitFor(() => expect(sent).toEqual([{ mobility: true }, { meal: "breakfast", state: "done" }]));
    await waitFor(() => expect(screen.queryByTestId("toggle-mobility-pending")).toBeNull());
    expect(screen.getByTestId("toggle-mobility").textContent).toContain(`✓ ${es.done.yes}`);
  });

  it("si el envío falla del todo, vuelve el estado anterior", async () => {
    mockApi({
      [URL]: (init) => (init?.method === "POST" ? { status: 500, body: {} } : { body: DAY }),
    });
    renderApp(<TodayPage />);
    fireEvent.click(await screen.findByTestId("toggle-mobility"));
    await waitFor(() => expect(screen.getByTestId("toggle-mobility").textContent).toContain(es.done.notYet));
    expect(screen.getByTestId("toggle-mobility").getAttribute("aria-pressed")).toBe("false");
  });
});
