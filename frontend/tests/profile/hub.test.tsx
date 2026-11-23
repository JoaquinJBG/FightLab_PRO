import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import ProfilePage from "@/app/(shell)/profile/page";
import ImportHubPage from "@/app/(shell)/profile/import-hub/page";
import { renderApp } from "../support/app";

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/lib/hooks", () => ({
  useMe: () => ({ data: { id: 1, email: "ana@example.com", role: "ATHLETE" } }),
  useProfile: () => ({ data: { date_of_birth: "1995-03-07", gender: "FEMALE", height_cm: 170, dominant_stance: "SOUTHPAW" } }),
  useLogout: () => ({ mutateAsync: vi.fn() }),
  useDisciplines: () => ({ gym: true, combat: true }),
  useSetDiscipline: () => ({ mutate: vi.fn(), isError: false }),
}));

describe("Perfil: la lista", () => {
  it("Editar perfil, Repetir el cribado, Avisos, Importar datos, Créditos y Cerrar sesión; sin Mi cocina ni Mi IA", () => {
    renderApp(<ProfilePage />);
    const nav = screen.getByRole("navigation");
    const links = Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Editar perfil", "/profile/edit"],
      ["Repetir el cribado", "/onboarding?redo=1"],
      ["Avisos", "/profile/reminders"],
      ["Importar datos", "/profile/import-hub"],
      ["Créditos y licencias", "/profile/credits"],
    ]);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(screen.queryByTestId("kitchen-link")).toBeNull();
    expect(screen.queryByTestId("my-ai-link")).toBeNull();
  });
});

describe("Importar datos (agrupador)", () => {
  it("agrupa Historial, Entrenos de Hevy y el Catálogo del súper, y vuelve a Perfil", () => {
    renderApp(<ImportHubPage />);
    const rows = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(rows).toEqual(["/profile", "/profile/import", "/training/gym/import", "/profile/import/catalogue"]);
    expect(screen.getByText("Historial")).toBeTruthy();
    expect(screen.getByText("Entrenos de Hevy")).toBeTruthy();
    expect(screen.getByText("Catálogo del súper")).toBeTruthy();
  });
});
