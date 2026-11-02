import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { LoadMetrics } from "@/lib/load";
import CoachPage from "@/app/(shell)/coach/page";
import { expectClean, renderEn } from "./_helpers";

const state = vi.hoisted(() => ({ logs: [] as unknown[], metrics: null as unknown }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/lib/hooks", () => ({ useBiometrics: () => ({ data: state.logs }) }));
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
  weekAU: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, provisional: true, monotonia: null, tension: null,
  sinVariacion: false, historyDays: 0,
};

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  state.logs = [];
  state.metrics = baseMetrics;
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
    state.metrics = { ...baseMetrics, weekAU: 600, acwr: 1.6, provisional: true, historyDays: 20, monotonia: 2.1 };
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70, date: new Date(Date.now() + 4 * day).toISOString() }));
    const { container } = renderEn(<CoachPage />);
    expect(screen.getByText("Load rising fast (ACWR 1.60)")).toBeTruthy();
    expect(screen.getByText("Low recovery signals")).toBeTruthy();
    expect(screen.getByText(/kg over target · weigh-in in 4 d/)).toBeTruthy();
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
    state.metrics = { ...baseMetrics, weekAU: 300, acwr: 1.0, provisional: false, historyDays: 40, monotonia: 1.5 };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderEn(<CoachPage />);
    fireEvent.click(screen.getByText("How am I doing?"));
    expect(await screen.findByText(/Your snapshot today: week 300 AU, ACWR 1\.00/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("rule-based")).toBeTruthy());
    fireEvent.click(screen.getByText("Train hard today?"));
    expect(await screen.findByText(/Today is not the day to kill yourself: Resting HR \+15 vs your average and HRV/)).toBeTruthy();
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
});
