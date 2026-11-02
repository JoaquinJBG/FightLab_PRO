import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import MyRoutinePage from "@/app/(shell)/training/my-routine/page";

describe("Mi rutina (en)", () => {
  it("pinta el plan semanal traducido", () => {
    const { container } = renderEn(<MyRoutinePage />);
    expect(screen.getByText("My routine")).toBeTruthy();
    expect(screen.getByText(/Your coach · updated 2 days ago/)).toBeTruthy();
    expect(screen.getByText("6 days")).toBeTruthy();
    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("Bench press 4×8")).toBeTruthy();
    expect(screen.getByText("Shadowboxing 3×3'")).toBeTruthy();
    expectClean(container, ["Carlos Méndez"]);
  });

  it("marcar un día como hecho", () => {
    const { container } = renderEn(<MyRoutinePage />);
    fireEvent.click(screen.getAllByLabelText("Mark as done")[0]);
    expectClean(container, ["Carlos Méndez"]);
  });
});
