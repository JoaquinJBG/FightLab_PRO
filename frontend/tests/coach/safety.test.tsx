import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import type { LoadMetrics } from "@/lib/load";
import CoachPage from "@/app/(shell)/coach/page";
import { renderEn } from "./_helpers";

// F3 ampliado y F26: un golpe en la cabeza activo y las lesiones guardadas mandan en el briefing,
// las recomendaciones y el chat por reglas del Coach, al momento.

const WEIGH_IN = {
  blocked: false, deficit_blocked: false, reasons: [], goal_weight_kg: null, goal_date: null, weigh_in_at: null,
  weight_class: null, days_left: null, current_kg: null, to_go_kg: null,
};
const state = vi.hoisted(() => ({ metrics: null as unknown, safety: undefined as unknown }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/lib/hooks", () => ({
  useBiometrics: () => ({ data: [] }),
  useSafety: () => ({ data: state.safety }),
  useWeighIn: () => ({ data: WEIGH_IN }),
}));
vi.mock("@/lib/load", () => ({ loadMetrics: () => state.metrics }));
vi.mock("@/lib/activities", () => ({ fetchServerMetrics: () => Promise.resolve(null) }));
vi.mock("@/components/evidence/CitedText", () => ({
  CitedText: ({ text }: { text: string }) => <span>{text}</span>,
}));

// Semana normal frente a la media: sin avisos de carga
const metrics: LoadMetrics = {
  weekAU: 400, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: 1.0, weekVsAvgPct: 0, ratioDaysLeft: 0, gaps: false,
  monotonia: 1.2, tension: 100, sinVariacion: false, band: null, historyDays: 28,
};
const injuryReason = (area: string) => ({
  code: "injury_unassessed", rule_key: "recovery-habits/some-pain-during-exercise-is-acceptable-in-chronic-assessed-pain",
  grade: "moderate", params: { area }, text: `${area} injury not yet assessed`, professional: null, severity: "refer",
});

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  state.metrics = metrics;
  state.safety = { flags: {}, reasons: [], disclaimer: "General guidance." };
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline"))); // sin IA: por reglas
});
afterEach(() => vi.unstubAllGlobals());

describe("Coach con un golpe en la cabeza activo (no_contact)", () => {
  beforeEach(() => {
    state.safety = { flags: { no_contact: true }, reasons: [], disclaimer: "General guidance." };
  });

  it("el briefing lo pone primero, con la vuelta por fases, y no ofrece «Go train»", () => {
    renderEn(<CoachPage />);
    expect(screen.getByText(/Contact is blocked after a blow to the head with symptoms/)).toBeTruthy();
    expect(screen.queryByText("Go train")).toBeNull();
    expect(screen.getByTestId("briefing-head-blow").getAttribute("href")).toBe("/training/mma");
    const chips = screen.getAllByTestId("evidence-chip").map((c) => c.getAttribute("data-rule") ?? c.textContent);
    expect(chips.length).toBeGreaterThan(0);
    // Recomendación que no se puede descartar, con la vuelta al contacto
    expect(screen.getByText("Contact blocked after a blow to the head")).toBeTruthy();
    expect(screen.queryByText(/No warnings: all good/)).toBeNull();
  });

  it("el chat por reglas nombra el golpe en vez de dar un consejo de carga", async () => {
    renderEn(<CoachPage />);
    fireEvent.click(screen.getByText("Train hard today?"));
    const reply = await screen.findByText(/First, the blow to the head you reported/);
    expect(reply.textContent).not.toMatch(/go hard|Quality technique|normal plan day/i);
  });
});

describe("Coach con una lesión guardada", () => {
  it("«my knee hurts» nombra el dolor y la lesión, y el entreno lleva su límite sin bloquear todo", async () => {
    state.safety = { flags: {}, reasons: [injuryReason("right knee")], disclaimer: "General guidance." };
    const { container } = renderEn(<CoachPage />);
    expect(container.textContent).toContain("Saved injury (right knee)");
    expect(screen.getByText("Saved injury: right knee")).toBeTruthy();

    const input = screen.getByPlaceholderText(/coach/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my knee hurts, should I train today?" } });
    fireEvent.submit(input.closest("form")!);
    const reply = await screen.findByText(/You have a saved injury: right knee\./);
    expect(reply.textContent).toMatch(/With new pain or an injury/);

    fireEvent.click(screen.getByText("Train hard today?"));
    const hard = await screen.findByText(/Mind your injury \(right knee\)/);
    expect(hard.textContent).not.toMatch(/go hard|you have room/i);
    expect(within(container).queryByText(/Contact is blocked/)).toBeNull();
  });
});
