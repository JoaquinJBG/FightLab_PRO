import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ExerciseDetail } from "@/components/exercises/ExerciseDetail";
import ExerciseCreditsPage from "@/app/(shell)/profile/credits/exercises/page";
import CreditsPage from "@/app/(shell)/profile/credits/page";
import { mockApi, renderApp } from "../support/app";
import { BENCH, LIST, MINE, SHADOW } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({}) }));

const BASE = "/api/proxy/gym/exercises";
afterEach(() => vi.unstubAllGlobals());

describe("ficha del ejercicio", () => {
  it("fotogramas, músculos, material, pasos con aviso de idioma y créditos con enlaces", async () => {
    mockApi({ [`${BASE}/cat/barbell-bench-press`]: { body: BENCH } });
    const { container } = renderApp(<ExerciseDetail exerciseKey={BENCH.key} />);
    expect(await screen.findByRole("heading", { name: "Press banca" })).toBeTruthy();
    expect(screen.getByText("Pecho")).toBeTruthy();
    expect(screen.getByText("Tríceps, Deltoides anterior")).toBeTruthy();
    expect(screen.getByText("Barra, Banco")).toBeTruthy();
    expect(screen.getByText("Estos pasos solo están en inglés por ahora.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((l) => l.textContent)).toContain("Lower the bar to the chest.");
    expect(container.querySelector("img")!.getAttribute("src")).toBe(BENCH.images[0].url);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://github.com/everkinetic/data");
    expect(hrefs).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(hrefs).toContain("https://wger.de/en/exercise/73/view/");
    expect(container.textContent).toContain("Imagen: Everkinetic · CC BY-SA 4.0");
    expect(container.textContent).toContain("Texto: wger.de contributors vía wger · CC BY-SA 4.0");
  });

  it("los fotogramas se pueden parar", async () => {
    mockApi({ [`${BASE}/cat/barbell-bench-press`]: { body: BENCH } });
    renderApp(<ExerciseDetail exerciseKey={BENCH.key} />);
    const toggle = await screen.findByRole("button", { name: "Parar la animación" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Animar" })).toBeTruthy();
  });

  it("sin imagen: icono genérico, aviso y pasos propios sin aviso de idioma", async () => {
    mockApi({ [`${BASE}/cat/shadow-boxing`]: { body: SHADOW } });
    renderApp(<ExerciseDetail exerciseKey={SHADOW.key} />);
    expect(await screen.findByText("Sin imagen con licencia abierta todavía.")).toBeTruthy();
    expect(screen.queryByText(/solo están en/)).toBeNull();
    expect(screen.getByText("Texto: FightLab · CC BY 4.0")).toBeTruthy();
  });

  it("en inglés enseña el aviso de pasos solo en español", async () => {
    mockApi({ [`${BASE}/cat/shadow-boxing`]: { body: SHADOW } });
    renderApp(<ExerciseDetail exerciseKey={SHADOW.key} />, "en");
    expect(await screen.findByText("These steps are only in Spanish for now.")).toBeTruthy();
  });

  it("propio: notas, editar y borrar con confirmación", async () => {
    const onDeleted = vi.fn();
    const fetchMock = mockApi({
      [`${BASE}/custom/7`]: (init) =>
        init?.method === "DELETE" ? { status: 204 }
          : init?.method === "PATCH" ? { body: { ...MINE, name: "Remo Meadows 2" } }
            : { body: MINE },
    });
    renderApp(<ExerciseDetail exerciseKey={MINE.key} onDeleted={onDeleted} />);
    expect(await screen.findByText("Barra en la esquina")).toBeTruthy();
    expect(screen.getByText("Ejercicio propio")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Remo Meadows");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Remo Meadows 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PATCH")).toBe(true));

    fireEvent.click(await screen.findByRole("button", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("si no existe, lo dice", async () => {
    mockApi({});
    renderApp(<ExerciseDetail exerciseKey="cat:nope" />);
    expect(await screen.findByText("Este ejercicio no existe o ya no está.")).toBeTruthy();
  });
});

describe("créditos", () => {
  it("la pantalla de Créditos enlaza a los de los ejercicios y a las licencias", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderApp(<CreditsPage />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/profile/credits/exercises");
    expect(hrefs).toContain("https://wger.de/");
    expect(hrefs).toContain("https://github.com/everkinetic/data");
    expect(container.textContent).toContain("Biblioteca de ejercicios");
  });

  it("lista autor y licencia de cada imagen, sin los propios ni los de texto propio", async () => {
    mockApi({ [BASE]: { body: LIST } });
    const { container } = renderApp(<ExerciseCreditsPage />);
    expect(await screen.findByText("1 ejercicio con créditos")).toBeTruthy();
    expect(screen.getByText("Press banca")).toBeTruthy();
    expect(screen.queryByText("Remo Meadows")).toBeNull();
    expect(screen.queryByText("Sombra")).toBeNull();
    expect(container.textContent).toContain("Everkinetic");
    expect(container.textContent).toContain("CC BY-SA 4.0");
  });
});
