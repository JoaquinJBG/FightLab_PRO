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
vi.mock("@/lib/activities", () => ({ enqueueActivity: vi.fn(), fetchServerMetrics: vi.fn(async () => null) }));

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

  it("asistente de rutina: formulario y rutina generada", async () => {
    vi.useFakeTimers();
    try {
      const { container } = renderEn(<GymPage />);
      fireEvent.click(screen.getByText("Create routine"));
      expect(screen.getByText("Simulated AI")).toBeTruthy();
      expect(screen.getByText("Body-part split (Weider)")).toBeTruthy();
      expect(screen.getByText("4 days")).toBeTruthy();
      expectClean(container);
      fireEvent.click(screen.getByText("Generate routine with AI"));
      expect(screen.getByText("Generating…")).toBeTruthy();
      expect(screen.getByText(/The AI is designing your routine \(Intermediate, 4 days, hypertrophy\)/)).toBeTruthy();
      await vi.advanceTimersByTimeAsync(1100);
      expect(screen.getByText("Suggested routine · 8-12 reps")).toBeTruthy();
      expect(screen.getByText(/Day 1/)).toBeTruthy();
      expect(screen.getByText("Apply to calendar")).toBeTruthy();
      expectClean(container);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Sesión de gimnasio (en)", () => {
  it("en vivo con foco: ejercicios, estadísticas y búsqueda", () => {
    nav.focus = "Empuje";
    localStorage.setItem(GYM_SESS_KEY, JSON.stringify([session]));
    const { container } = renderEn(<GymSessionPage />);
    expect(screen.getByText("Workout · Push")).toBeTruthy();
    expect(screen.getByText("Bench press")).toBeTruthy();
    expect(screen.getByText(/Last time: 2×8 · 80 kg · PR 80 kg/)).toBeTruthy();
    expect(screen.getAllByText(/First time — fresh start/).length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getAllByLabelText("Set done")[0]);
    expect(screen.getByText("+30s")).toBeTruthy();
    expectClean(container);

    fireEvent.click(screen.getByText("Finish workout"));
    expect(screen.getByText("How did it go?")).toBeTruthy();
    expect(screen.getByText("Complete at least one set with kg and reps to save.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("What is RPE"));
    expect(screen.getByText(/Rating of Perceived Exertion/)).toBeTruthy();
    fireEvent.click(screen.getByText("7"));
    expect(screen.getByText(/Load:/)).toBeTruthy();
    expectClean(container);
  });
});
