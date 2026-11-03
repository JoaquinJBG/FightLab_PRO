import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import GymPage from "@/app/(shell)/training/gym/page";
import GymSessionPage from "@/app/(shell)/training/gym/session/page";
import { GYM_LIVE_KEY, GYM_SESS_KEY } from "@/lib/gym";

const nav = vi.hoisted(() => ({ focus: null as string | null, push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => ({ get: (k: string) => (k === "focus" ? nav.focus : null) }),
}));
vi.mock("@/lib/activities", () => ({
  enqueueActivity: vi.fn(), fetchServerMetrics: vi.fn(async () => null),
  // historial del servidor (beta): sin respuesta, "Última vez"/PR salen del local
  fetchServerActivities: vi.fn(async () => null), pendingQueueItems: () => [], mergeByClientId: (...xs: unknown[][]) => xs.flat(),
}));
vi.mock("@/lib/plan", () => ({ useWeeklyPlan: () => ({ data: undefined }) }));

beforeEach(() => { localStorage.clear(); nav.focus = null; nav.push.mockClear(); });

const session = {
  id: "1", ts: Date.now() - 3600_000, focus: "Empuje", durationSec: 3600, rpe: 7, load: 420, volume: 4200,
  exercises: [{ name: "Press banca", sets: [{ kg: 80, reps: 8 }, { kg: 80, reps: 6 }] }, { name: "Fondos", sets: [{ kg: 0, reps: 10 }] }],
};

describe("Gimnasio (en)", () => {
  it("calendario y últimos entrenos, con foco y ejercicios traducidos", () => {
    localStorage.setItem(GYM_SESS_KEY, JSON.stringify([session]));
    const { container } = renderEn(<GymPage />);
    expect(screen.getByText("Gym")).toBeTruthy();
    expect(screen.getByText("Your week")).toBeTruthy();
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("Recent workouts")).toBeTruthy();
    expect(screen.getByText(/2 exercises · 3 sets/)).toBeTruthy();
    expectClean(container);
  });

  it("entreno sin terminar", () => {
    localStorage.setItem(GYM_LIVE_KEY, JSON.stringify({ startedAt: Date.now(), savedAt: Date.now(), focus: "Pierna", exercises: [{ name: "Sentadilla", sets: [] }] }));
    const { container } = renderEn(<GymPage />);
    expect(screen.getByText("Unfinished workout")).toBeTruthy();
    expect(screen.getByText(/Legs · 1 exercise$/)).toBeTruthy();
    expectClean(container);
  });

  it("sin el asistente de rutina simulado (retirado en la beta)", () => {
    const { container } = renderEn(<GymPage />);
    expect(screen.queryByText("Create routine")).toBeNull();
    expect(screen.queryByText("Simulated AI")).toBeNull();
    expect(screen.getByText(/saved to your account/)).toBeTruthy();
    expectClean(container);
  });
});

describe("Sesión de gimnasio (en)", () => {
  it("en vivo con foco: ejercicios, estadísticas y búsqueda", async () => {
    nav.focus = "Empuje";
    localStorage.setItem(GYM_SESS_KEY, JSON.stringify([session]));
    const { container } = renderEn(<GymSessionPage />);
    expect(screen.getByText("Workout · Push")).toBeTruthy();
    expect(screen.getByText("Bench press")).toBeTruthy();
    expect(screen.getByText(/Last time: 2×8 · 80 kg · PR 80 kg/)).toBeTruthy();
    // "Primera vez" solo cuando el historial del servidor ya respondió (beta)
    expect((await screen.findAllByText(/First time — fresh start/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("previous: 80 kg × 8 · tap to copy").length).toBe(1);
    expect(screen.getByText("Rest between sets")).toBeTruthy();
    expectClean(container);

    fireEvent.click(screen.getByText("+ Add exercise"));
    const input = screen.getByPlaceholderText("Search: press, row, squat…");
    fireEvent.change(input, { target: { value: "curl" } });
    expect(screen.getByText("Hammer curl")).toBeTruthy();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No results.")).toBeTruthy();
    expectClean(container);
  });

  it("completar una serie arranca el descanso y el resumen pide RPE", () => {
    nav.focus = "Pierna";
    const { container } = renderEn(<GymSessionPage />);
    fireEvent.click(screen.getAllByLabelText("Set 1 done")[0]);
    expect(screen.getByText("+30s")).toBeTruthy();
    expectClean(container);

    fireEvent.click(screen.getByText("Finish workout"));
    // la serie ✓ sin reps no se guarda: aviso en línea antes del resumen (beta)
    expect(screen.getByRole("alertdialog").textContent).toContain("1 set ticked ✓ without reps won't be saved.");
    expectClean(container);
    fireEvent.click(screen.getByText("Finish anyway"));
    expect(screen.getByText("How did it go?")).toBeTruthy();
    expect(screen.getByText("Tick ✓ at least one set with reps to save.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("What is RPE"));
    expect(screen.getByText(/Rating of Perceived Exertion/)).toBeTruthy();
    fireEvent.click(screen.getByText("7"));
    expect(screen.getByText(/Load:/)).toBeTruthy();
    expectClean(container);
  });

  it("quitar un ejercicio se deshace y descartar pide confirmación", () => {
    localStorage.setItem(GYM_LIVE_KEY, JSON.stringify({
      startedAt: Date.now(), savedAt: Date.now(), focus: null,
      exercises: [
        { name: "Press banca", sets: [{ kg: "80", reps: "8", done: true }] },
        { name: "Remo con barra", sets: [{ kg: "60", reps: "10", done: true }] },
      ],
    }));
    const { container } = renderEn(<GymSessionPage />);
    fireEvent.click(screen.getByLabelText("Remove Bench press"));
    fireEvent.click(screen.getByLabelText("Remove Barbell row"));
    expect(screen.getByRole("status").textContent).toContain("Removed: Barbell row (+1)");
    expectClean(container);
    fireEvent.click(screen.getByText("Undo"));
    fireEvent.click(screen.getByText("Undo"));
    expect(screen.getByText("Bench press")).toBeTruthy();
    expect(screen.getByText("Barbell row")).toBeTruthy();
    fireEvent.click(screen.getByText("Finish workout"));
    expect(screen.getByText("sets")).toBeTruthy(); // 2 series en el resumen (plural)
    fireEvent.click(screen.getByText("Discard workout"));
    expect(screen.getByText("Discard the workout? All sets will be lost.")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Discard workout")).toBeTruthy();
    expectClean(container);
  });
});
