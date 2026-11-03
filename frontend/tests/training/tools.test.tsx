import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import ToolsPage from "@/app/(shell)/training/tools/page";

describe("Herramientas (en)", () => {
  it("temporizador de rounds: configuración", () => {
    const { container } = renderEn(<ToolsPage />);
    expect(screen.getByText("Tools")).toBeTruthy();
    expect(screen.getByText("Boxing")).toBeTruthy();
    expect(screen.getByText("End-of-round warning")).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByText("Start · 5 rounds")).toBeTruthy();
    expectClean(container);
  });

  it("plural de rounds y arranque del temporizador", () => {
    const { container } = renderEn(<ToolsPage />);
    fireEvent.click(screen.getByText("Tabata"));
    expect(screen.getByText("Start · 8 rounds")).toBeTruthy();
    fireEvent.click(screen.getByText("Start · 8 rounds"));
    expect(screen.getByText("Get ready")).toBeTruthy();
    expect(screen.getByText("Round 1 / 8")).toBeTruthy();
    expect(screen.getByText("Skip")).toBeTruthy();
    expect(screen.getByText("Exit")).toBeTruthy();
    expectClean(container);
    fireEvent.click(screen.getByText("Pause"));
    expect(screen.getByText("Resume")).toBeTruthy();
    expectClean(container);
  });

  it("cronómetro: iniciar, vuelta y reset", () => {
    const { container } = renderEn(<ToolsPage />);
    fireEvent.click(screen.getByText("Stopwatch"));
    fireEvent.click(screen.getByText("Start"));
    fireEvent.click(screen.getByText("Lap"));
    expect(screen.getByText("Lap 1")).toBeTruthy();
    expectClean(container);
    fireEvent.click(screen.getByText("Pause"));
    expect(screen.getByText("Reset")).toBeTruthy();
    expectClean(container);
  });
});
