import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { expectClean, renderEn } from "./i18nB-helpers";
import GymSessionPage from "@/app/(shell)/training/gym/session/page";
import { GYM_SESS_KEY } from "@/lib/gym";
import { gymStats, type LastStats } from "@/lib/strength";

// Fase 9: "Última vez" y récords del gimnasio desde el servidor (`SetLog` y el e1RM del coach).
// Lo del navegador queda solo para lo que el servidor aún no tiene.

const state = vi.hoisted(() => ({
  server: undefined as Record<string, unknown> | undefined,
  names: [] as string[],
  checks: [] as unknown[],
  enqueue: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "focus" ? "Empuje" : null) }),
}));
vi.mock("@/lib/activities", () => ({
  enqueueActivity: state.enqueue,
  // F17: el guardado va al momento (`POST activities`); aquí, a la cola como sin red
  saveActivityNow: async (item: unknown) => { state.enqueue(item); return { status: "queued" }; },
  firstReason: () => null,
  // historial de sesiones del servidor (beta): sin respuesta, "Última vez" sale de SetLog o del navegador
  fetchServerActivities: vi.fn(async () => null), pendingQueueItems: () => [], mergeByClientId: (...xs: unknown[][]) => xs.flat(),
}));
vi.mock("@/lib/plan", () => ({ useWeeklyPlan: () => ({ data: undefined }) }));
// Récords de antes del entreno (F17): sin datos del servidor
vi.mock("@/lib/gym-api", async (orig) => ({ ...(await orig<typeof import("@/lib/gym-api")>()), useRecords: () => ({ data: undefined }) }));
vi.mock("@/lib/session-check", async (orig) => ({ ...(await orig<typeof import("@/lib/session-check")>()), useSessionCheck: (p: unknown) => { state.checks.push(p); return { data: undefined }; } }));
vi.mock("@/lib/strength", async (orig) => ({
  ...(await orig<typeof import("@/lib/strength")>()),
  useLastStats: (names: string[]) => { state.names = names; return { data: state.server }; },
}));

const local = {
  id: "1", ts: Date.now() - 86400_000, focus: "Empuje", durationSec: 3600, rpe: 7, load: 420, volume: 1000,
  exercises: [{ name: "Press banca", sets: [{ kg: 85, reps: 3 }] }, { name: "Fondos", sets: [{ kg: 0, reps: 12 }] }],
};
const stat = (over: Partial<LastStats> = {}): LastStats => ({
  last: { date: "2026-10-20", sets: 3, reps: 6, weight_kg: 75 }, pr_kg: 80, best_e1rm_kg: 96, ...over,
});

beforeEach(() => { localStorage.clear(); state.server = undefined; state.checks = []; state.enqueue.mockClear(); });

describe("gymStats", () => {
  it("del servidor cuando tiene el ejercicio; el récord es el mayor de los dos", () => {
    localStorage.setItem(GYM_SESS_KEY, JSON.stringify([local]));
    expect(gymStats("Press banca", { "Press banca": stat() })).toEqual({ last: "3×6 · 75 kg", prKg: 85, e1rmKg: 96, fromServer: true });
    expect(gymStats("Press banca", { "Press banca": stat({ pr_kg: 90 }) }).prKg).toBe(90);
  });

  it("del navegador si el servidor no lo tiene o no ha contestado", () => {
    localStorage.setItem(GYM_SESS_KEY, JSON.stringify([local]));
    expect(gymStats("Press banca", undefined)).toEqual({ last: "1×3 · 85 kg", prKg: 85, e1rmKg: null, fromServer: false });
    expect(gymStats("Press banca", { "Press banca": stat({ last: null, pr_kg: null, best_e1rm_kg: null }) }).fromServer).toBe(false);
  });

  it("con el peso corporal no hay kg ni récord", () => {
    expect(gymStats("Fondos", { Fondos: stat({ last: { date: "2026-10-20", sets: 2, reps: 12, weight_kg: null }, pr_kg: null, best_e1rm_kg: null }) }))
      .toEqual({ last: "2×12", prKg: null, e1rmKg: null, fromServer: true });
  });
});

describe("Sesión de gimnasio con datos del servidor (en)", () => {
  it("pide los ejercicios de la sesión y enseña última vez, récord y e1RM con su etiqueta", async () => {
    state.server = { "Press banca": stat() };
    const { container } = renderEn(<GymSessionPage />);
    expect(state.names).toEqual(["Press banca", "Press militar", "Fondos", "Extensión de tríceps"]);
    expect(screen.getByText(/Last time: 3×6 · 75 kg · PR 80 kg/)).toBeTruthy();
    const e1rm = screen.getByTestId("gym-e1rm");
    expect(e1rm.textContent).toBe("e1RM ≈ 96 kgCoach convention");
    // "First time" sale cuando ha respondido el historial de sesiones del servidor (beta)
    expect((await screen.findAllByText(/First time — fresh start/)).length).toBe(3);
    expectClean(container);
  });
});

describe("Sesión de gimnasio: test de 1RM y pliometría (en)", () => {
  it("lo marcado va al aviso del servidor y se guarda en la sesión", () => {
    const { container } = renderEn(<GymSessionPage />);
    const [kg, reps] = screen.getAllByPlaceholderText("—");
    fireEvent.change(kg, { target: { value: "100" } });
    fireEvent.change(reps, { target: { value: "1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Set 1 done" })[0]); // solo se guardan las series ✓ (beta)
    fireEvent.click(screen.getByText("Finish workout"));
    expect(screen.getByText("Did it include any of these?")).toBeTruthy();
    expect(state.checks.at(-1)).toBeNull(); // sin nada marcado no se pregunta
    fireEvent.click(screen.getByRole("button", { name: "A 1RM test" }));
    expect(state.checks.at(-1)).toEqual({ kind: "GYM", includes: ["one_rm_test"] });
    expectClean(container);
    fireEvent.click(screen.getByText("Save"));
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ includes: ["one_rm_test"] }),
    }));
  });
});
