import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import WeighInPage from "@/app/(shell)/nutrition/weigh-in/page";
import { WeighSync } from "@/components/weigh-sync";
import { LEGACY_WEIGH_KEY, WEIGH_MIGRATED_KEY, daysUntil, mirrorValue, parseLegacyWeigh, weighInDate } from "@/lib/weigh";
import { PROFILE, SAFETY, WEIGH_IN, mockApi, renderApp } from "../support/app";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const SAVED = { ...WEIGH_IN, goal_weight_kg: 68.5, goal_date: "2026-11-12", weigh_in_at: "2026-11-12T09:00:00Z", days_left: 14, to_go_kg: 1.5 };
const route = (weighIn: unknown) => ({
  "/api/proxy/coach/weigh-in": { body: weighIn },
  "/api/proxy/coach/safety": { body: SAFETY },
  "/api/proxy/me/profile": { body: PROFILE },
});

describe("pantalla de pesaje", () => {
  it("muestra la cuenta atrás, el actual, el objetivo y lo que falta, del servidor", async () => {
    mockApi(route(SAVED));
    renderApp(<WeighInPage />);
    const summary = await screen.findByTestId("weigh-summary");
    expect(summary.textContent).toContain("14");
    expect(summary.textContent).toContain("68,5");
    expect(screen.getByTestId("weigh-to-go").textContent).toContain("1,5");
  });

  it("con el déficit bloqueado no da el 'por bajar' y lo explica", async () => {
    mockApi(route({ ...SAVED, deficit_blocked: true, to_go_kg: null }));
    renderApp(<WeighInPage />);
    await screen.findByTestId("weigh-summary");
    expect(screen.queryByTestId("weigh-to-go")).toBeNull();
    expect(screen.getByTestId("weigh-deficit-note")).toBeTruthy();
  });

  it("con no_weight_targets no muestra nada de pesaje: ni formulario, ni cuenta atrás, ni categoría", async () => {
    mockApi(route({ ...WEIGH_IN, blocked: true }));
    renderApp(<WeighInPage />);
    expect(await screen.findByTestId("weigh-blocked")).toBeTruthy();
    expect(screen.queryByTestId("weigh-summary")).toBeNull();
    expect(screen.queryByTestId("weigh-save")).toBeNull();
    expect(screen.queryByTestId("weigh-target")).toBeNull();
  });

  it("guarda con PUT al servidor (peso objetivo y fecha), no en localStorage", async () => {
    const calls = mockApi({ ...route(WEIGH_IN), "/api/proxy/coach/weigh-in": (init) => ({ body: init?.method === "PUT" ? SAVED : WEIGH_IN }) });
    renderApp(<WeighInPage />);
    fireEvent.click(await screen.findByTestId("weigh-save"));
    await waitFor(() => {
      const put = calls.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put![1]!.body));
      expect(body.goal_weight_kg).toBe(70);
      expect(new Date(body.weigh_in_at).getTime()).toBeGreaterThan(Date.now());
    });
    expect(localStorage.getItem(LEGACY_WEIGH_KEY)).toBeNull();
  });

  it("explica el rechazo del servidor a un peso objetivo por debajo del actual", async () => {
    mockApi({
      ...route({ ...WEIGH_IN, deficit_blocked: true }),
      "/api/proxy/coach/weigh-in": (init) =>
        init?.method === "PUT" ? { status: 400, body: { code: "deficit_blocked" } } : { body: { ...WEIGH_IN, deficit_blocked: true } },
    });
    renderApp(<WeighInPage />);
    fireEvent.click(await screen.findByTestId("weigh-save"));
    const error = await screen.findByTestId("weigh-error");
    expect(error.getAttribute("data-code")).toBe("deficit_blocked");
  });
});

describe("puente provisional de flp_weigh (WeighSync)", () => {
  it("migra el pesaje antiguo una vez y marca la migración", async () => {
    localStorage.setItem(LEGACY_WEIGH_KEY, JSON.stringify({ target: 66, date: "2026-11-20T09:00:00.000Z" }));
    const calls = mockApi({ ...route(WEIGH_IN), "/api/proxy/coach/weigh-in": (init) => ({ body: init?.method === "PUT" ? { ...SAVED, goal_weight_kg: 66 } : WEIGH_IN }) });
    renderApp(<WeighSync />);
    await waitFor(() => expect(localStorage.getItem(WEIGH_MIGRATED_KEY)).toBe("1"));
    const put = calls.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put![1]!.body))).toEqual({ goal_weight_kg: 66, weigh_in_at: "2026-11-20T09:00:00.000Z" });
  });

  it("no pisa un pesaje que el servidor ya tiene", async () => {
    localStorage.setItem(LEGACY_WEIGH_KEY, JSON.stringify({ target: 60, date: "2026-12-01T09:00:00.000Z" }));
    const calls = mockApi(route(SAVED));
    renderApp(<WeighSync />);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LEGACY_WEIGH_KEY)!).target).toBe(68.5)); // refleja el del servidor
    expect(calls.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("con no_weight_targets borra flp_weigh para que Biometría y Coach tampoco lo muestren", async () => {
    localStorage.setItem(LEGACY_WEIGH_KEY, JSON.stringify({ target: 66, date: "2026-11-20T09:00:00.000Z" }));
    const calls = mockApi(route({ ...WEIGH_IN, blocked: true }));
    renderApp(<WeighSync />);
    await waitFor(() => expect(localStorage.getItem(LEGACY_WEIGH_KEY)).toBeNull());
    expect(calls.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("al quitar el pesaje en el servidor se quita también el espejo", async () => {
    localStorage.setItem(WEIGH_MIGRATED_KEY, "1");
    localStorage.setItem(LEGACY_WEIGH_KEY, JSON.stringify({ target: 66, date: "2026-11-20T09:00:00.000Z" }));
    mockApi(route(WEIGH_IN));
    renderApp(<WeighSync />);
    await waitFor(() => expect(localStorage.getItem(LEGACY_WEIGH_KEY)).toBeNull());
  });
});

describe("lib/weigh", () => {
  it("lee el flp_weigh antiguo o lo descarta si está corrupto", () => {
    expect(parseLegacyWeigh(JSON.stringify({ target: 70, date: "2026-11-01T09:00:00Z" }))).toEqual({ target: 70, date: "2026-11-01T09:00:00Z" });
    for (const bad of [null, "", "{", JSON.stringify({ target: "70", date: "x" }), JSON.stringify({ target: 70, date: "no" })]) {
      expect(parseLegacyWeigh(bad)).toBeNull();
    }
  });

  it("solo se refleja un pesaje que el servidor da", () => {
    expect(mirrorValue(undefined)).toBeNull();
    expect(mirrorValue({ ...SAVED, blocked: true })).toBeNull();
    expect(mirrorValue(WEIGH_IN)).toBeNull();
    expect(mirrorValue(SAVED)).toEqual({ target: 68.5, date: "2026-11-12T09:00:00Z" });
  });

  it("la fecha del pesaje es hoy + N días y la cuenta atrás es por días naturales", () => {
    const now = new Date(2026, 9, 29, 22, 30);
    const iso = weighInDate(14, now);
    expect(daysUntil(iso, now)).toBe(14);
    expect(daysUntil(weighInDate(0, now), now)).toBe(0);
    expect(daysUntil(weighInDate(-2, now), now)).toBe(-2);
  });
});
