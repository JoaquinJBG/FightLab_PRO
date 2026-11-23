import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ExercisePicker } from "@/components/exercises/ExercisePicker";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { RECENT_KEY, loadRecentKeys } from "@/lib/exercises";
import { mockApi, renderApp } from "../support/app";
import { BENCH, LIST, MINE, PULLDOWN, SHADOW } from "./fixtures";

const LIST_URL = "/api/proxy/gym/exercises";

function open(props: { multiple?: boolean } = {}, locale: "es" | "en" = "es") {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  renderApp(<ExercisePicker onSelect={onSelect} onClose={onClose} {...props} />, locale);
  return { onSelect, onClose };
}

const names = () =>
  within(screen.getByTestId("exercise-picker-list"))
    .getAllByRole("button", { name: /^(Elegir|Choose) / })
    .map((b) => b.getAttribute("aria-label")!.replace(/^(Elegir|Choose) /, ""));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("ExercisePicker", () => {
  it("lista la biblioteca y los propios, y busca sin acentos", async () => {
    mockApi({ [LIST_URL]: { body: LIST } });
    open();
    expect(await screen.findByText("Press banca")).toBeTruthy();
    expect(screen.getByText("Remo Meadows")).toBeTruthy();
    expect(screen.getByText("Propio")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar en la biblioteca de ejercicios"), { target: { value: "JALON" } });
    expect(names()[0]).toBe("Jalón al pecho");
  });

  it("pide la lista en el idioma de la app", async () => {
    const fetchMock = mockApi({ [LIST_URL]: { body: LIST } });
    open({}, "en");
    await screen.findByText("Press banca");
    expect(String(fetchMock.mock.calls[0][0])).toContain("lang=en");
  });

  it("filtra por músculo y material", async () => {
    mockApi({ [LIST_URL]: { body: LIST } });
    open();
    await screen.findByText("Press banca");
    fireEvent.change(screen.getByLabelText("Músculo"), { target: { value: "lats" } });
    expect(names()).toEqual(["Jalón al pecho"]);
    fireEvent.change(screen.getByLabelText("Músculo"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "bodyweight" } });
    expect(names()).toEqual(["Sombra"]);
  });

  it("simple: al tocar uno lo elige, lo guarda en recientes y cierra", async () => {
    mockApi({ [LIST_URL]: { body: LIST } });
    const { onSelect, onClose } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Elegir Press banca" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: BENCH.key }));
    expect(onClose).toHaveBeenCalled();
    expect(loadRecentKeys()).toEqual([BENCH.key]);
  });

  it("enseña los recientes arriba, sin búsqueda", async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([PULLDOWN.key, "cat:gone"]));
    mockApi({ [LIST_URL]: { body: LIST } });
    open();
    const recent = await screen.findByRole("region", { name: "Recientes" });
    expect(within(recent).getAllByRole("button", { name: /^Elegir / })).toHaveLength(1);
    expect(within(recent).getByText("Jalón al pecho")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar en la biblioteca de ejercicios"), { target: { value: "press" } });
    expect(screen.queryByRole("region", { name: "Recientes" })).toBeNull();
  });

  it("varios: marca en orden y añade todos al confirmar", async () => {
    mockApi({ [LIST_URL]: { body: LIST } });
    const { onSelect, onClose } = open({ multiple: true });
    fireEvent.click(await screen.findByRole("button", { name: "Elegir Sombra" }));
    fireEvent.click(screen.getByRole("button", { name: "Elegir Press banca" }));
    fireEvent.click(screen.getByRole("button", { name: "Elegir Remo Meadows" }));
    fireEvent.click(screen.getByRole("button", { name: "Elegir Remo Meadows" })); // desmarca
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Añadir (2)" }));
    expect(onSelect.mock.calls.map((c) => c[0].key)).toEqual([SHADOW.key, BENCH.key]);
    expect(onClose).toHaveBeenCalled();
  });

  it("crea un ejercicio propio desde la búsqueda sin resultados y lo elige", async () => {
    const created = { ...MINE, key: "custom:9", id: 9, name: "Press Landmine" };
    const fetchMock = mockApi({
      [LIST_URL]: { body: LIST },
      [`${LIST_URL}/custom`]: (init) => (init?.method === "POST" ? { status: 201, body: created } : { status: 405 }),
    });
    const { onSelect } = open();
    await screen.findByText("Press banca");
    fireEvent.change(screen.getByLabelText("Buscar en la biblioteca de ejercicios"), { target: { value: "Press Landmine" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear «Press Landmine»" }));
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Press Landmine");
    // Sin músculo principal no se manda
    fireEvent.click(screen.getByRole("button", { name: "Crear y añadir" }));
    expect(await screen.findByText("Elige al menos un músculo principal.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Músculo principal"), { target: { value: "chest" } });
    fireEvent.click(screen.getByRole("button", { name: "Tríceps" }));
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "barbell" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear y añadir" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "custom:9" })));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      name: "Press Landmine",
      primary_muscles: ["chest"],
      secondary_muscles: ["triceps"],
      equipment: ["barbell"],
      notes: "",
    });
  });

  it("enseña los errores del servidor al crear", async () => {
    mockApi({
      [LIST_URL]: { body: LIST },
      [`${LIST_URL}/custom`]: { status: 400, body: { name: ["Nombre demasiado largo."] } },
    });
    open();
    await screen.findByText("Press banca");
    fireEvent.click(screen.getByRole("button", { name: "+ Crear ejercicio" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Músculo principal"), { target: { value: "chest" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear y añadir" }));
    expect(await screen.findByText("Nombre demasiado largo.")).toBeTruthy();
  });

  it("abre la ficha desde la lista y vuelve", async () => {
    mockApi({
      [LIST_URL]: { body: LIST },
      [`${LIST_URL}/cat/barbell-bench-press`]: { body: BENCH },
    });
    const { onSelect } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Ver la ficha de Press banca" }));
    expect(await screen.findByText("Cómo se hace")).toBeTruthy();
    expect(screen.getByText("Estos pasos solo están en inglés por ahora.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: BENCH.key }));
  });

  it("si falla la carga, deja reintentar", async () => {
    mockApi({ [LIST_URL]: { status: 500 } });
    open();
    expect(await screen.findByText("No se pudo cargar la biblioteca de ejercicios.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("Escape cierra", async () => {
    mockApi({ [LIST_URL]: { body: LIST } });
    const { onClose } = open();
    await screen.findByText("Press banca");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ExerciseThumb", () => {
  it("con imagen enseña el primer fotograma; sin ella, el icono de su tipo", () => {
    renderApp(
      <>
        <ExerciseThumb exercise={BENCH} />
        <ExerciseThumb exercise={SHADOW} />
        <ExerciseThumb exercise={null} />
      </>,
    );
    const img = screen.getByTestId("exercise-thumb-image").querySelector("img")!;
    expect(img.getAttribute("src")).toBe(BENCH.images[0].url);
    expect(img.getAttribute("alt")).toBe("");
    expect(screen.getAllByTestId("exercise-thumb-icon")).toHaveLength(2);
  });
});
