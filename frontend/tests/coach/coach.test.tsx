import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { LoadMetrics } from "@/lib/load";
import CoachPage from "@/app/(shell)/coach/page";
import { expectClean, renderEn } from "./_helpers";

const WEIGH_IN = {
  blocked: false, deficit_blocked: false, reasons: [], goal_weight_kg: null, goal_date: null, weigh_in_at: null,
  weight_class: null, days_left: null, current_kg: null, to_go_kg: null,
};
const state = vi.hoisted(() => ({
  logs: [] as unknown[], metrics: null as unknown, safety: undefined as unknown, weighIn: undefined as unknown,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/lib/hooks", () => ({
  useBiometrics: () => ({ data: state.logs }),
  useSafety: () => ({ data: state.safety }),
  useWeighIn: () => ({ data: state.weighIn }),
}));
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
  monotonia: null, tension: null, sinVariacion: false, band: null, historyDays: 0,
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
  state.weighIn = WEIGH_IN;
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
    state.weighIn = { ...WEIGH_IN, goal_weight_kg: 70, days_left: 4 };
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

  it("con no_weight_targets (o sin saberlo aún) no hay peso, ni pesaje, ni avisos de pesarse", () => {
    state.logs = tiredLogs;
    state.weighIn = { ...WEIGH_IN, blocked: true, goal_weight_kg: 70, days_left: 4 };
    const { container } = renderEn(<CoachPage />);
    expect(container.textContent).not.toMatch(/kg over target|weigh-in in|75\.0 kg/);
    state.weighIn = undefined; // cargando: se oculta, que es lo seguro
    const again = renderEn(<CoachPage />);
    expect(again.container.textContent).not.toContain("75.0 kg");
  });

  it("con el déficit bloqueado sigue la cuenta atrás, pero no 'a X kg del objetivo'", () => {
    state.logs = tiredLogs;
    state.weighIn = { ...WEIGH_IN, deficit_blocked: true, goal_weight_kg: 70, days_left: 4 };
    const { container } = renderEn(<CoachPage />);
    expect(container.textContent).not.toMatch(/kg over target/);
    expect(container.textContent).toContain("75.0 kg");
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
    await waitFor(() => expect(screen.getAllByText("rule-based").length).toBeGreaterThan(0));
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
    expect(screen.getAllByText("Real AI").length).toBeGreaterThan(0);
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
    state.weighIn = { ...WEIGH_IN, goal_weight_kg: 70, days_left: 4 };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderEn(<CoachPage />);
    expect(screen.queryByText(/kg above target/)).toBeNull();
    fireEvent.click(screen.getByText("How's my weight?"));
    expect(await screen.findByText(/shows no weight-cut information to under-18s/)).toBeTruthy();
  });

  it("con el déficit bloqueado no hay consejo de corte ni distancia al objetivo", () => {
    state.logs = tiredLogs;
    state.safety = safety({ no_deficit: true });
    state.weighIn = { ...WEIGH_IN, goal_weight_kg: 70, days_left: 4 };
    const { container } = renderEn(<CoachPage />);
    expect(screen.queryByText(/kg above target/)).toBeNull();
    expect(container.textContent).not.toContain("kg from your target");
  });

  it("memoria del coach (P0.3): se edita y se guarda en inglés, y la carga avanzada sin ACWR", async () => {
    state.metrics = { ...baseMetrics, weekAU: 300, acwr: 1.0, weekVsAvgPct: 0, ratioDaysLeft: 0, historyDays: 28, monotonia: 1.5 };
    const { container } = renderEn(<CoachPage />);
    expect(screen.queryByLabelText("Speak")).toBeNull(); // micrófono simulado retirado
    expect(screen.getByText("What your coach knows about you")).toBeTruthy();
    fireEvent.click(await screen.findByText("Tell my coach"));
    fireEvent.change(screen.getByPlaceholderText("E.g. sore right shoulder"), { target: { value: "shoulder" } });
    fireEvent.change(screen.getAllByDisplayValue("No preference")[0], { target: { value: "directo" } }); // tono
    expect(screen.getByPlaceholderText("E.g. 77.5")).toBeTruthy();
    expectClean(container, [/shoulder/]);
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByText("Injury: shoulder")).toBeTruthy();
    expect(screen.getByText("Tone: Straight-talking")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("flp_coach_memory") ?? "{}")).toMatchObject({ lesion: "shoulder", tono: "directo" });
    expect(container.textContent).toContain("Week/average ratio: 1.00 · Monotony 1.5");
    noSafeZone(container.textContent);
    expectClean(container, [/shoulder/]);
  });

  it("memoria: con no_weight_targets no se pide ni se enseña el objetivo de peso", async () => {
    localStorage.setItem("flp_coach_memory", JSON.stringify({ objetivo_peso_kg: 70, fase: "camp" }));
    state.safety = safety({ no_weight_targets: true });
    state.weighIn = { ...WEIGH_IN, blocked: true };
    renderEn(<CoachPage />);
    expect(await screen.findByText("Phase: camp")).toBeTruthy();
    expect(screen.queryByText(/Target: 70 kg/)).toBeNull();
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.queryByPlaceholderText("E.g. 77.5")).toBeNull();
  });

  it("memoria: con avisos 'solo lo esencial' se ocultan las recomendaciones informativas", async () => {
    localStorage.setItem("flp_coach_memory", JSON.stringify({ frecuencia_avisos: "baja" }));
    renderEn(<CoachPage />);
    expect(await screen.findByText("Alerts: Essentials only")).toBeTruthy();
    expect(screen.queryByText("Log your first session of the week")).toBeNull();
  });
});
