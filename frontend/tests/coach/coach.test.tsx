import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { LoadMetrics } from "@/lib/load";
import CoachPage from "@/app/(shell)/coach/page";
import { expectClean, renderEn } from "./_helpers";

const state = vi.hoisted(() => ({ logs: [] as unknown[], metrics: null as unknown, safety: undefined as unknown }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/lib/hooks", () => ({ useBiometrics: () => ({ data: state.logs }), useSafety: () => ({ data: state.safety }) }));
vi.mock("@/lib/load", () => ({ loadMetrics: () => state.metrics }));
vi.mock("@/lib/activities", () => ({ fetchServerMetrics: () => Promise.resolve(null) }));
vi.mock("@/components/evidence/CitedText", () => ({
  CitedText: ({ text }: { text: string }) => <span>{text}</span>,
}));

const day = 86_400_000;
const bio = (i: number, rhr: number, hrv: number, weight: string | null) => ({
  id: i, weight_kg: weight, body_fat_pct: null, resting_heart_rate: rhr, sleep_quality_score: null,
  hrv_ms: hrv, waist_cm: null, hip_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, neck_cm: null,
  timestamp: new Date(Date.now() - i * day * 3).toISOString(), source: "MANUAL",
});
// El más reciente primero: FC reposo muy por encima de la media y HRV muy por debajo -> "cuidado"
const tiredLogs = [bio(0, 70, 30, "75.0"), bio(1, 55, 60, null), bio(2, 55, 60, null), bio(3, 55, 60, null), bio(4, 55, 60, null)];
const baseMetrics: LoadMetrics = {
  weekAU: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, weekVsAvgPct: null, ratioDaysLeft: 28, gaps: false,
  monotonia: null, tension: null, sinVariacion: false, historyDays: 0,
};
const safety = (flags: Record<string, boolean> = {}) => ({ flags, reasons: [], disclaimer: "General guidance." });
const noSafeZone = (text: string | null) => {
  expect(text).not.toMatch(/safe zone|injury risk|ACWR 1\.|optimal zone/i);
};

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  state.logs = [];
  state.metrics = baseMetrics;
  state.safety = safety();
});
afterEach(() => vi.unstubAllGlobals());

describe("vista Coach en inglés", () => {
  it("sin datos: briefing, recomendación inicial y chat sin claves ni español", () => {
    const { container } = renderEn(<CoachPage />);
    expect(screen.getByText("Today's briefing")).toBeTruthy();
    expect(screen.getByText("Log your first session of the week")).toBeTruthy();
    expectClean(container);
  });

  it("con datos: carga alta, recuperación baja y pesaje cercano", () => {
    state.logs = tiredLogs;
    state.metrics = { ...baseMetrics, weekAU: 600, acwr: 1.6, weekVsAvgPct: 60, ratioDaysLeft: 0, historyDays: 28, monotonia: 2.1 };
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70, date: new Date(Date.now() + 4 * day).toISOString() }));
    const { container } = renderEn(<CoachPage />);
    // Anexo de combate: la semana frente a la media, sin "zona segura" ni ratio con semáforo
    expect(screen.getByText("Week 60% above your average")).toBeTruthy();
    expect(screen.getByTestId("coach-load-badge").textContent).toBe("+60% vs your average");
    noSafeZone(container.textContent);
    expect(screen.getByText("Low recovery signals")).toBeTruthy();
    expect(screen.getByText(/kg above target · weigh-in in 4 d/)).toBeTruthy();
    expect(container.textContent).toContain("FightLab gives no cutting protocols");
    expect(container.textContent).not.toMatch(/48-72|water|sodium/i);
    // Cada número de carga y el consejo de corte llevan su regla
    expect(container.querySelectorAll('[data-testid="evidence-chip"][data-variant="evidence"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Take it easy")).toBeTruthy();
    expect(container.textContent).toContain("Resting HR +15 vs your average");
    expectClean(container);
  });

  it("descartar y votar siguen funcionando", () => {
    state.logs = tiredLogs;
    renderEn(<CoachPage />);
    fireEvent.click(screen.getAllByLabelText("Helpful")[0]);
    expect(screen.getByText("Thanks! 👍")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Dismiss")[0]);
  });

  it("chat sin IA: responde por reglas en inglés con los datos locales", async () => {
    state.logs = tiredLogs;
    state.metrics = { ...baseMetrics, weekAU: 300, acwr: 1.0, weekVsAvgPct: 0, ratioDaysLeft: 0, historyDays: 28, monotonia: 1.5 };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderEn(<CoachPage />);
    fireEvent.click(screen.getByText("How am I doing?"));
    expect(await screen.findByText(/Your snapshot today: week 300 AU, at your 4-week average/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("rule-based")).toBeTruthy());
    fireEvent.click(screen.getByText("Train hard today?"));
    expect(await screen.findByText(/Today is not the day to run yourself into the ground: Resting HR \+15 vs your average and HRV/)).toBeTruthy();
    fireEvent.click(screen.getByText("How's my weight?"));
    expect(await screen.findByText(/Your latest weight is 75\.0 kg/)).toBeTruthy();
    expect(container.textContent).toContain("AI isn't available right now");
    expectClean(container);
  });

  it("chat con IA: muestra la respuesta del servidor y la insignia", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: "Server says hi" }) }));
    renderEn(<CoachPage />);
    fireEvent.change(screen.getByPlaceholderText("Ask your coach…"), { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Send"));
    expect(await screen.findByText("Server says hi")).toBeTruthy();
    expect(screen.getByText("Real AI")).toBeTruthy();
  });

  it("con menos de 28 días no hay ratio: faltan N días", async () => {
    state.metrics = { ...baseMetrics, weekAU: 420, historyDays: 12, ratioDaysLeft: 16 };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderEn(<CoachPage />);
    expect(screen.getByTestId("coach-load-badge").textContent).toBe("Load: 16 d to go");
    fireEvent.click(screen.getByText("Train hard today?"));
    expect(await screen.findByText(/16 more days of history before it can be compared with your average/)).toBeTruthy();
    noSafeZone(container.textContent);
  });

  it("menores: sin contenido de corte", async () => {
    state.logs = tiredLogs;
    state.safety = safety({ no_cut_content: true, no_weight_targets: true });
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70, date: new Date(Date.now() + 4 * day).toISOString() }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderEn(<CoachPage />);
    expect(screen.queryByText(/kg above target/)).toBeNull();
    fireEvent.click(screen.getByText("How's my weight?"));
    expect(await screen.findByText(/shows no weight-cut information to under-18s/)).toBeTruthy();
  });

  it("con el déficit bloqueado no hay consejo de corte ni distancia al objetivo", () => {
    state.logs = tiredLogs;
    state.safety = safety({ no_deficit: true });
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70, date: new Date(Date.now() + 4 * day).toISOString() }));
    const { container } = renderEn(<CoachPage />);
    expect(screen.queryByText(/kg above target/)).toBeNull();
    expect(container.textContent).not.toContain("kg from your target");
  });
});
