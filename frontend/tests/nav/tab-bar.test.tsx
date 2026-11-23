import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { TabBar, activeTab } from "@/components/tab-bar";
import { renderApp } from "../support/app";

const nav = vi.hoisted(() => ({ path: "/today" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

describe("barra de pestañas", () => {
  it("son cinco: Hoy · Entreno · Nutrición · Progreso · Coach (sin Perfil)", () => {
    nav.path = "/today";
    renderApp(<TabBar />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(["Hoy", "Entreno", "Nutrición", "Progreso", "Coach"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/today", "/training", "/nutrition", "/dashboard", "/coach"]);
  });

  it("marca activa la pestaña que toca en cada ruta", () => {
    const cases: [string, string | null][] = [
      ["/today", "today"],
      ["/profile", "today"],
      ["/profile/import-hub", "today"],
      ["/profile/import/catalogue", "today"],
      ["/dashboard", "progress"],
      ["/biometrics", "progress"],
      ["/biometrics/new", "progress"],
      ["/training/load", "progress"],
      ["/training/review", "progress"],
      ["/training", "training"],
      ["/training/gym", "training"],
      ["/training/gym/import", "training"],
      ["/nutrition/menu", "nutrition"],
      ["/coach", "coach"],
      ["/otra-cosa", null],
    ];
    for (const [path, tab] of cases) expect(activeTab(path), path).toBe(tab);
  });

  it("solo una pestaña lleva aria-current", () => {
    nav.path = "/training/review";
    renderApp(<TabBar />);
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.getAttribute("aria-label"))).toEqual(["Progreso"]);
  });
});
