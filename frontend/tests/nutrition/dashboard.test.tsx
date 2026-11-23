import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import DashboardPage from "@/app/(shell)/dashboard/page";
import type { Biometrics } from "@/lib/schemas";
import { CATALOGS, PROFILE, SAFETY, WEIGH_IN, mockApi, renderApp, type Locale } from "../support/app";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const log = (id: number, over: Partial<Biometrics> = {}): Biometrics => ({
  id, weight_kg: "72.0", body_fat_pct: "15.0", resting_heart_rate: 55, sleep_quality_score: null, hrv_ms: 80,
  waist_cm: null, hip_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, neck_cm: null,
  timestamp: daysAgo(id), source: "MANUAL", ...over,
});
const LOGS = [log(20), log(21), log(22), log(23), log(24)]; // el último peso es de hace 20 días

const routes = (over: Record<string, unknown> = {}) => ({
  "/api/proxy/me": { body: { id: 1, email: "ana@fightlab.test", is_email_verified: true } },
  "/api/proxy/me/biometrics": { body: LOGS },
  "/api/proxy/coach/safety": { body: SAFETY },
  "/api/proxy/coach/weigh-in": { body: WEIGH_IN },
  "/api/proxy/me/profile": { body: PROFILE },
  "/api/proxy/activities/metrics": { status: 404 },
  ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, { body: v }])),
});

describe("Progreso con los bloqueos del servidor (spec §8.3)", () => {
  it("sin bloqueos muestra el peso y la distancia al objetivo", async () => {
    mockApi(routes({ "/api/proxy/coach/weigh-in": { ...WEIGH_IN, goal_weight_kg: 70, to_go_kg: 2, current_kg: 72 } }));
    renderApp(<DashboardPage />);
    expect(await screen.findByTestId("weight-card")).toBeTruthy();
    expect(screen.getByTestId("weight-to-goal").textContent).toContain("2,0 kg");
  });

  it("es un mosaico de accesos: carga, peso, medidas, revisión, récords, zonas y fotos, y el botón de medir", async () => {
    mockApi(routes({ "/api/proxy/coach/zones": ZONES }));
    renderApp(<DashboardPage />);
    const d = CATALOGS.es.dashboard;
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Progreso");
    expect((await screen.findByTestId("load-summary")).getAttribute("href")).toBe("/training/load");
    expect(screen.getByTestId("weight-card").getAttribute("href")).toBe("/biometrics");
    expect(screen.getByTestId("measures-card").getAttribute("href")).toBe("/biometrics");
    expect(screen.getByRole("link", { name: new RegExp(d.tiles.review) }).getAttribute("href")).toBe("/training/review");
    expect(screen.getByRole("link", { name: new RegExp(d.tiles.records) }).getAttribute("href")).toBe("/training/gym/records");
    expect(screen.getByRole("link", { name: new RegExp(d.tiles.photos) }).getAttribute("href")).toBe("/biometrics");
    expect(await screen.findByTestId("zones-tile")).toBeTruthy();
    expect(screen.getByRole("link", { name: new RegExp(d.cta.measure) }).getAttribute("href")).toBe("/biometrics/new");
    // lo que ya enseña Hoy no se repite aquí
    expect(screen.queryByTestId("checkin-card")).toBeNull();
    expect(screen.queryByTestId("state-no-training")).toBeNull();
    expect(screen.queryByTestId("safety-banner")).toBeNull();
  });

  it("los mosaicos enseñan los mismos números: peso, FC en reposo, HRV y % de grasa", async () => {
    mockApi(routes());
    renderApp(<DashboardPage />);
    const measures = await screen.findByTestId("measures-card");
    expect(measures.textContent).toContain(CATALOGS.es.dashboard.metrics.rhr);
    expect(measures.textContent).toContain("55");
    expect(measures.textContent).toContain("80");
    expect(measures.textContent).toContain("15,0");
    expect(screen.getByTestId("weight-card").textContent).toContain("72,0");
  });

  it("con no_weight_targets no hay nada de peso: ni tarjeta, ni tendencia, ni % grasa", async () => {
    mockApi(routes({ "/api/proxy/coach/weigh-in": { ...WEIGH_IN, blocked: true } }));
    renderApp(<DashboardPage />);
    await screen.findByTestId("measures-card");
    await waitFor(() => expect(screen.queryByTestId("weight-card")).toBeNull());
    expect(screen.queryByText(CATALOGS.es.dashboard.metrics.fat)).toBeNull();
    expect(screen.queryByText(CATALOGS.es.dashboard.weight.emptyTitle)).toBeNull();
    // lo que no es peso sigue: FC en reposo y HRV
    expect(screen.getByText(CATALOGS.es.dashboard.metrics.rhr)).toBeTruthy();
  });

  it("con el déficit bloqueado se ve el peso pero no 'a X kg de tu objetivo'", async () => {
    mockApi(routes({ "/api/proxy/coach/weigh-in": { ...WEIGH_IN, deficit_blocked: true, goal_weight_kg: 70, to_go_kg: null } }));
    renderApp(<DashboardPage />);
    expect(await screen.findByTestId("weight-card")).toBeTruthy();
    expect(screen.queryByTestId("weight-to-goal")).toBeNull();
  });

  it.each(["es", "en"] as Locale[])("Progreso se escribe en %s", async (locale) => {
    mockApi(routes());
    renderApp(<DashboardPage />, locale);
    expect(await screen.findByText(CATALOGS[locale].dashboard.tiles.records)).toBeTruthy();
    expect(screen.getByText(CATALOGS[locale].load.title)).toBeTruthy(); // la tarjeta de carga (E.5)
  });
});

const ZONES = {
  method: "hrmax",
  zones: [
    { name: "light", rpe: [9, 11], talk_test: "can talk and sing", bpm: [120, 132] },
    { name: "moderate", rpe: [12, 13], talk_test: "can talk, but not sing", bpm: [133, 159] },
    { name: "vigorous", rpe: [14, 17], talk_test: "only a few words without pausing for breath", bpm: [160, 199] },
  ],
  hr_max: 187, hr_max_source: "tanaka", hr_rest: null, hr_rest_date: null,
  rules: [{ key: "cardio-health/acsm-intensity-bands", grade: "moderate", title: "ACSM intensity bands" }],
  reasons: [
    { code: "hrmax_tanaka", rule_key: "cardio-health/hrmax-formulas-and-setting-the-anchor", grade: "moderate", params: {}, text: "la frecuencia máxima de Tanaka es una estimación de partida", professional: null, severity: "info" },
  ],
};

describe("zonas de esfuerzo en Progreso (mosaico que abre un panel)", () => {
  it("muestra las zonas del motor con su chip y los motivos con regla", async () => {
    mockApi(routes({ "/api/proxy/coach/zones": ZONES }));
    renderApp(<DashboardPage />);
    fireEvent.click(await screen.findByTestId("zones-tile"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    const card = await screen.findByTestId("zones-card");
    expect(card.getAttribute("data-method")).toBe("hrmax");
    expect(screen.getByTestId("zone-moderate").textContent).toContain("133–159 bpm");
    expect(screen.getByTestId("zone-moderate").textContent).toContain("puedes hablar, pero no cantar");
    expect(card.querySelector('[data-testid="evidence-chip"]')).toBeTruthy();
    expect(screen.getByTestId("zones-reason").getAttribute("data-code")).toBe("hrmax_tanaka");
  });

  it("sin zonas (no_training) no pinta la tarjeta", async () => {
    mockApi(routes({ "/api/proxy/coach/zones": { ...ZONES, method: "no_training", zones: [] } }));
    renderApp(<DashboardPage />);
    await screen.findByTestId("measures-card");
    expect(screen.queryByTestId("zones-tile")).toBeNull();
  });

  it("un perfil que da RPE (betabloqueantes) enseña solo el esfuerzo percibido", async () => {
    mockApi(routes({
      "/api/proxy/coach/zones": { ...ZONES, method: "rpe", zones: ZONES.zones.slice(0, 2).map((z) => ({ ...z, bpm: null })), hr_max: null },
    }));
    renderApp(<DashboardPage />);
    fireEvent.click(await screen.findByTestId("zones-tile"));
    await screen.findByTestId("zones-card");
    expect(screen.getByTestId("zone-light").textContent).not.toContain("bpm");
    expect(screen.queryByTestId("zone-vigorous")).toBeNull();
  });
});
