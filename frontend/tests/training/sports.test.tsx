import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errors, expectClean, renderEn } from "./sportsmma-helpers";
import SportsPage from "@/app/(shell)/training/sports/page";

vi.mock("@/lib/hooks", () => ({ useBiometrics: () => ({ data: [{ weight_kg: "80" }] }) }));
vi.mock("@/lib/activities", () => ({ enqueueActivity: vi.fn(), deleteServerActivities: vi.fn() }));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const seed = (ts: number) => JSON.stringify([
  { id: "1", sportKey: "run", sportName: "Correr", durationSec: 1800, kcal: 300, intensity: "Moderado", rpe: 6, load: 180, ts },
  { id: "2", sportKey: "swim", sportName: "Natación", durationSec: 600, kcal: 90, intensity: "Intenso", rpe: null, load: null, ts: ts - 3 * 86400_000 },
]);

describe("training/sports en inglés", () => {
  it("lista de deportes", () => {
    const { container } = renderEn(<SportsPage />);
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Soccer")).toBeTruthy();
    expectClean(container);
  });

  it("registro vacío y con datos", () => {
    const { container } = renderEn(<SportsPage />);
    fireEvent.click(screen.getByText("Activity"));
    expect(screen.getByText(/You haven't logged any activity yet/)).toBeTruthy();
    expectClean(container);
    cleanup();
    localStorage.setItem("flp_activities", seed(Date.now()));
    const r2 = renderEn(<SportsPage />);
    fireEvent.click(screen.getByText("Activity"));
    expect(screen.getByText(/Today ·/)).toBeTruthy();
    expect(screen.getByText(/RPE 6 · 180 AU/)).toBeTruthy();
    expect(screen.getByText("Swimming")).toBeTruthy();
    expectClean(r2.container);
  });

  it("sesión sin terminar", () => {
    localStorage.setItem("flp_live_session", JSON.stringify({ sportKey: "bike", elapsed: 120, kcal: 30, intIdx: 1, savedAt: Date.now() }));
    const { container } = renderEn(<SportsPage />);
    expect(screen.getByText("Unfinished session")).toBeTruthy();
    expect(screen.getByLabelText("Discard session")).toBeTruthy();
    expectClean(container);
  });

  it("flujo: iniciar, en vivo, parar, resumen con RPE y guardar", () => {
    vi.useFakeTimers();
    const { container } = renderEn(<SportsPage />);
    fireEvent.click(screen.getByText("Running"));
    expect(screen.getByText("← Sports")).toBeTruthy();
    fireEvent.click(screen.getByText("Hard"));
    expect(screen.getByText("12–16 km/h")).toBeTruthy();
    fireEvent.click(screen.getByText("Easy"));
    expectClean(container);
    fireEvent.click(screen.getByText("Start"));
    expect(screen.getByText("Cancel")).toBeTruthy();
    for (let i = 0; i < 3; i++) act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText("Pause")).toBeTruthy();
    expect(screen.getByText("Hold to stop")).toBeTruthy();
    expect(screen.getByText(/The screen won't turn off/)).toBeTruthy();
    expectClean(container);
    fireEvent.click(screen.getByText("Pause"));
    expect(screen.getByText("Resume")).toBeTruthy();
    fireEvent.click(screen.getByText("Resume"));
    act(() => { vi.advanceTimersByTime(3000); });
    const hold = screen.getByText("Hold to stop").closest("button")!;
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("How did it go?")).toBeTruthy();
    expect(screen.getByText(/You can save without RPE/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("What is RPE"));
    expect(screen.getByText(/Rating of Perceived Exertion/)).toBeTruthy();
    fireEvent.click(screen.getByText("5"));
    expect(screen.getByText(/Session load:/)).toBeTruthy();
    expectClean(container);
    errors.length = 0;
  });
});
