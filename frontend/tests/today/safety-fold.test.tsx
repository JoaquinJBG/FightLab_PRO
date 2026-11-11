import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { SafetyPanel } from "@/components/safety/SafetyBanner";
import { SAFETY, renderApp } from "../support/app";
import type { Safety } from "@/lib/schemas";

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

// F23 de la prueba en móvil: con una lesión en el alta, la tarjeta de seguridad ocupaba toda la
// primera pantalla de Hoy cada día.

const reason = (code: string, severity: "stop" | "refer" | "limit") => ({
  code, rule_key: null, grade: null, params: {}, text: `aviso ${code}`, professional: null, severity,
});
const injured: Safety = { ...SAFETY, reasons: [reason("injury_knee", "refer"), reason("injury_load", "limit")] };

beforeEach(() => localStorage.clear());

describe("tarjeta de seguridad en Hoy (F23)", () => {
  it("se pliega, se queda plegada ese día y al día siguiente vuelve a salir entera", () => {
    const first = renderApp(<SafetyPanel data={injured} foldDay="2026-11-09" />);
    expect(screen.getByTestId("safety-banner").dataset.folded).toBe("false");
    // La lista tiene un alto máximo con scroll propio: no ocupa la primera pantalla entera
    expect(screen.getByTestId("safety-reasons").className).toMatch(/max-h-\[38dvh\]/);

    fireEvent.click(screen.getByRole("button", { name: "Plegar" }));
    const banner = screen.getByTestId("safety-banner");
    expect(banner.dataset.folded).toBe("true");
    expect(banner.textContent).toContain("2 avisos de seguridad");
    expect(banner.textContent).toContain("Consulta"); // el aviso más serio
    expect(screen.queryByText("aviso injury_knee")).toBeNull();

    first.unmount();
    renderApp(<SafetyPanel data={injured} foldDay="2026-11-09" />);
    expect(screen.getByTestId("safety-banner").dataset.folded).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(screen.getByText("aviso injury_knee")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Plegar" }));
  });

  it("otro día sale desplegada", () => {
    localStorage.setItem("flp_safety_folded", "2026-11-08");
    renderApp(<SafetyPanel data={injured} foldDay="2026-11-09" />);
    expect(screen.getByTestId("safety-banner").dataset.folded).toBe("false");
  });

  it("fuera de Hoy (Perfil, Resumen) no se pliega", () => {
    renderApp(<SafetyPanel data={injured} />);
    expect(screen.queryByRole("button", { name: "Plegar" })).toBeNull();
    expect(screen.getByTestId("safety-reasons").className).not.toMatch(/max-h/);
  });
});
