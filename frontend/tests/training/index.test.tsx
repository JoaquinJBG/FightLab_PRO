import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import TrainingHubPage from "@/app/(shell)/training/page";

const metrics = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/activities", () => ({ fetchServerMetrics: vi.fn(async () => metrics.value) }));

const base = { weekAU: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, provisional: true, monotonia: null, tension: null, sinVariacion: false, historyDays: 0 };

describe("hub de Entreno (en)", () => {
  it("sin datos: resumen vacío y las 5 tarjetas", () => {
    metrics.value = null;
    const { container } = renderEn(<TrainingHubPage />);
    expect(screen.getByText("Load and status")).toBeTruthy();
    expect(screen.getByText("Stopwatch and round timer")).toBeTruthy();
    expect(screen.getByText("My routine")).toBeTruthy();
    expectClean(container);
  });

  it("con carga y ACWR provisional", async () => {
    metrics.value = { ...base, weekAU: 420, acwr: 1.1, historyDays: 12 };
    const { container } = renderEn(<TrainingHubPage />);
    await waitFor(() => expect(screen.getByText("Week")).toBeTruthy());
    expect(screen.getByText("1.10*")).toBeTruthy();
    expect(screen.getByText(/ACWR is provisional/)).toBeTruthy();
    expectClean(container);
  });
});
