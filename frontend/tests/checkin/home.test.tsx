import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import DashboardPage from "@/app/(shell)/dashboard/page";
import type { Biometrics } from "@/lib/schemas";
import { CATALOGS, PROFILE, SAFETY, WEIGH_IN, mockApi, renderApp } from "../support/app";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const log = (id: number): Biometrics => ({
  id, weight_kg: "72.0", body_fat_pct: null, resting_heart_rate: 55, sleep_quality_score: null, hrv_ms: 80,
  waist_cm: null, hip_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, neck_cm: null,
  timestamp: daysAgo(id), source: "MANUAL",
});

const TREND_BASE = {
  blocked: false, rate_kg_week: null, rate_pct_week: null, weight_kg: null, points: 0, days: 0, start: null, end: null,
  can_recalibrate: false, min_points: 7, min_days: 14,
  rule_key: "nutrition/read-the-scale-with-weekly-averages", grade: "moderate", reasons: [],
};
const TREND_FEW = { ...TREND_BASE, status: "insufficient_data", points: 3, days: 5 };
const TREND_OK = { ...TREND_BASE, status: "ok", rate_kg_week: -0.4, rate_pct_week: -0.55, weight_kg: 71.8, points: 9, days: 20 };
const READINESS = {
  status: "no_data", drops_today: [], days_with_drop: 0, hrv_drop: false,
  rule_key: "recovery-habits/simple-readiness-monitoring", grade: "moderate",
  hrv_rule_key: "recovery-habits/hrv-is-optional", hrv_grade: "emerging",
};
const STATE = { date: "2026-10-29", checkin: null, weight_blocked: false, weekly_questions: [], readiness: READINESS };

const routes = (over: Record<string, unknown> = {}) => ({
  "/api/proxy/me": { body: { id: 1, email: "ana@fightlab.test", is_email_verified: true } },
  "/api/proxy/me/biometrics": { body: [log(1), log(2), log(3)] },
  "/api/proxy/coach/safety": { body: SAFETY },
  "/api/proxy/coach/weigh-in": { body: WEIGH_IN },
  "/api/proxy/me/profile": { body: PROFILE },
  "/api/proxy/activities/metrics": { status: 404 },
  "/api/proxy/coach/trend": { body: TREND_FEW },
  "/api/proxy/coach/checkin": { body: STATE },
  ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, { body: v }])),
});

describe("Home: tendencia de peso y check-in de hoy", () => {
  it("la tarjeta de peso dice que aún no hay tendencia y cuántos pesajes llevas, sin chip anidado en el enlace", async () => {
    mockApi(routes());
    renderApp(<DashboardPage />);
    const box = await screen.findByTestId("trend-insufficient");
    expect(box.textContent).toMatch(/\b7\b/);
    expect(box.closest("[data-testid=weight-card]")).toBeTruthy();
    expect(box.querySelector("button")).toBeNull();
  });

  it("con datos suficientes muestra el ritmo semanal del coach, no la diferencia entre pesajes sueltos", async () => {
    mockApi(routes({ "/api/proxy/coach/trend": TREND_OK }));
    renderApp(<DashboardPage />);
    const ok = await screen.findByTestId("trend-ok");
    expect(ok.textContent).toMatch(/0,40/);
    expect(ok.textContent).toMatch(/kg por semana/);
  });

  it("con no_weight_targets no se pide ni se muestra la tendencia", async () => {
    const calls = mockApi(routes({ "/api/proxy/coach/weigh-in": { ...WEIGH_IN, blocked: true } }));
    renderApp(<DashboardPage />);
    await screen.findByText(CATALOGS.es.dashboard.week.title);
    await waitFor(() => expect(screen.queryByTestId("weight-card")).toBeNull());
    expect(screen.queryByTestId("trend-insufficient")).toBeNull();
    expect(calls.mock.calls.some(([url]) => String(url).includes("/coach/trend"))).toBe(false);
  });

  it("sin check-in hoy invita a hacerlo; con check-in dice que está hecho y la readiness", async () => {
    mockApi(routes());
    const first = renderApp(<DashboardPage />);
    const card = await screen.findByTestId("checkin-card");
    expect(card.getAttribute("href")).toBe("/checkin");
    expect(card.textContent).toContain(CATALOGS.es.checkin.homeCard.cta);
    first.unmount();

    mockApi(
      routes({
        "/api/proxy/coach/checkin": {
          ...STATE,
          checkin: { date: "2026-10-29", weight_kg: null, waist_cm: null, intake_kcal: null, resting_heart_rate: null, hrv_ms: null, sleep_hours: 7, sleep_quality: 4, energy: 4, soreness: 4, stress: 4, mood: 4, soreness_zones: [], illness: null, notes: "", period_status: null, hormonal_contraception: null, bp_systolic: null, bp_diastolic: null },
          readiness: { ...READINESS, status: "reduce", drops_today: ["energy", "stress"] },
        },
      }),
    );
    renderApp(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId("checkin-card").textContent).toContain(CATALOGS.es.checkin.homeCard.done));
    expect(screen.getByTestId("checkin-card").textContent).toContain(CATALOGS.es.checkin.readiness.reduce);
  });
});
