import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import TrainingHubPage from "@/app/(shell)/training/page";

const today = vi.hoisted(() => ({ value: { data: undefined, isLoading: false } as { data: unknown; isLoading: boolean } }));
vi.mock("@/lib/today", async (orig) => ({
  ...(await orig<typeof import("@/lib/today")>()),
  useToday: () => today.value,
}));

const withPlan = (entries: unknown[]) => ({
  data: { plan: { id: 1, week_start: "2026-11-23", type: "gym", entries } },
  isLoading: false,
});

describe("hub de Entreno (en)", () => {
  it("cabecera con el temporizador, Registrar 2×2 y Planificar", () => {
    today.value = { data: { plan: null }, isLoading: false };
    const { container } = renderEn(<TrainingHubPage />);
    expect(screen.getByTestId("hub-timer").getAttribute("href")).toBe("/training/tools");
    expect(screen.getByTestId("hub-gym").getAttribute("href")).toBe("/training/gym");
    expect(screen.getByTestId("hub-mma").getAttribute("href")).toBe("/training/mma");
    expect(screen.getByTestId("hub-sports").getAttribute("href")).toBe("/training/sports");
    expect(screen.getByTestId("hub-history").getAttribute("href")).toBe("/training/gym");
    expect(screen.getByTestId("hub-week").getAttribute("href")).toBe("/training/plan");
    expect(screen.getByTestId("hub-routines").getAttribute("href")).toBe("/training/routines");
    // Fuera de la portada: carga, revisión, ejercicios, mi rutina y la tarjeta de herramientas
    for (const href of ["/training/load", "/training/review", "/training/exercises", "/training/my-routine"]) {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    }
    expectClean(container);
  });

  it("sin plan: el estado vacío lleva a prepararlo", () => {
    today.value = { data: { plan: null }, isLoading: false };
    renderEn(<TrainingHubPage />);
    expect(screen.getByTestId("hub-today-plan").getAttribute("href")).toBe("/training/plan");
    expect(screen.queryByTestId("hub-today-start")).toBeNull();
  });

  it("con una sesión de gimnasio hoy: la enseña y Empezar abre la sesión del plan", () => {
    today.value = withPlan([{ kind: "gym", session: "A", exercises: ["Squat", "Bench press"] }]);
    const { container } = renderEn(<TrainingHubPage />);
    expect(screen.getByText("Gym · session A")).toBeTruthy();
    expect(screen.getByText("Squat · Bench press")).toBeTruthy();
    expect(screen.getByTestId("hub-today-start").getAttribute("href")).toBe("/training/gym/session?plan=A");
    expectClean(container);
  });

  it("día de descanso del plan: sin botón de empezar", () => {
    today.value = withPlan([]);
    renderEn(<TrainingHubPage />);
    expect(screen.getByText(/Rest day/)).toBeTruthy();
    expect(screen.queryByTestId("hub-today-start")).toBeNull();
  });
});
