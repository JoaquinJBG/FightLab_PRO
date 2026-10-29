import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectClean, renderEn } from "./sportsmma-helpers";
import MmaPage from "@/app/(shell)/training/mma/page";

vi.mock("@/lib/activities", () => ({ enqueueActivity: vi.fn(), deleteServerActivities: vi.fn() }));

beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("training/mma en inglés", () => {
  it("formulario por defecto, todas las artes y tipos de trabajo", () => {
    const { container } = renderEn(<MmaPage />);
    expect(screen.getByText("Suggested plan")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Boxing" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Wrestling" })).toBeTruthy();
    for (const w of ["Sparring", "Drilling", "Pads", "Bag work", "Technique", "Conditioning"]) {
      fireEvent.click(screen.getByRole("button", { name: w }));
      expectClean(container);
    }
    for (const art of ["BJJ", "Lucha", "Muay Thai", "Kickboxing", "MMA"]) {
      fireEvent.change(container.querySelector("select")!, { target: { value: art } });
      expectClean(container);
    }
    fireEvent.click(screen.getByLabelText("What is RPE"));
    expect(screen.getByText(/Rating of Perceived Exertion/)).toBeTruthy();
    expectClean(container);
  });

  it("guardar sesión, estadísticas del mes e historial", () => {
    vi.useFakeTimers();
    const { container } = renderEn(<MmaPage />);
    fireEvent.change(screen.getByPlaceholderText("Partner (optional)"), { target: { value: "Leo" } });
    fireEvent.change(screen.getByPlaceholderText(/Notes: techniques worked/), { target: { value: "good rounds" } });
    fireEvent.click(screen.getByText("Save session"));
    expect(screen.getByText("Saved ✓")).toBeTruthy();
    expect(screen.getByText("This month")).toBeTruthy();
    expect(screen.getByText("Your MMA sessions")).toBeTruthy();
    expect(screen.getByText(/with Leo/)).toBeTruthy();
    expect(screen.getByText(/Today ·/)).toBeTruthy();
    expectClean(container);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("Save session")).toBeTruthy();
  });

  it("historial antiguo (sin tipo)", () => {
    localStorage.setItem("flp_mma", JSON.stringify([
      { id: "1", art: "Boxeo", mode: "Sparring", minutes: 45, rpe: 7, load: 315, ts: Date.now() - 40 * 86400_000 },
      { id: "2", art: "BJJ", minutes: 60, rpe: 5, load: 300, ts: Date.now() - 41 * 86400_000 },
    ]));
    const { container } = renderEn(<MmaPage />);
    expect(screen.getAllByText(/Boxing/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Session/)).toBeTruthy();
    expectClean(container);
  });

  it("chat del coach: saludo, respuestas rápidas y micro", () => {
    vi.useFakeTimers();
    const { container } = renderEn(<MmaPage />);
    fireEvent.click(screen.getByLabelText("Open coach chat"));
    expect(screen.getByText(/Ready to train!/)).toBeTruthy();
    expect(screen.getByText("AI Coach")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What should I do today?" }));
    expect(screen.getByText("The coach is typing…")).toBeTruthy();
    expectClean(container);
    act(() => { vi.advanceTimersByTime(700); });
    for (const q of ["I have 30 min", "Remind me to stretch"]) {
      fireEvent.click(screen.getByRole("button", { name: q }));
      act(() => { vi.advanceTimersByTime(700); });
    }
    expect(screen.getByText(/gentle stretching/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Speak"));
    expect(screen.getByPlaceholderText("Listening…")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2200); });
    expect(screen.getByText(/Today I want to do technique for boxing/)).toBeTruthy();
    expectClean(container);
    fireEvent.change(screen.getByPlaceholderText("Type or tap the mic…"), { target: { value: "water please" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByText(/Sip water/)).toBeTruthy();
    expectClean(container);
  });
});
