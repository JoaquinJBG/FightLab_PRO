import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import KitchenPage from "@/app/(shell)/profile/kitchen/page";
import { CATALOGS, mockApi, renderApp } from "../support/app";
import { cleanDiners } from "@/lib/kitchen";

// Fase 12: perfil de cocina. El menaje y los comensales los rellena el usuario; nada va en el código.

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const KITCHEN = {
  equipment: {}, filled: false,
  limits: { pots: [0, 10], pressure_cookers: [0, 4], frying_pans: [0, 10], burners_large: [0, 8], burners_small: [0, 8], air_fryer_model: [0, 80] },
  diners: [], meals: ["breakfast", "lunch", "dinner", "snack"], categories: ["carne", "cerdo", "lacteos", "marisco", "pescado"],
  categories_convention: "fightlab",
};

describe("cleanDiners", () => {
  it("quita nombres vacíos, restricciones sin palabras y el id", () => {
    expect(cleanDiners([
      { id: 4, name: " Pareja ", restrictions: [{ meals: ["dinner"], exclude: ["pescado", ""], allow: ["gambas"] }, { meals: [], exclude: [], allow: [] }] },
      { name: "  ", restrictions: [] },
    ])).toEqual([{ name: "Pareja", restrictions: [{ meals: ["dinner"], exclude: ["pescado"], allow: ["gambas"] }] }]);
  });
});

describe.each(["es", "en"] as const)("Mi cocina (%s)", (locale) => {
  const cat = CATALOGS[locale].kitchen;

  it("guarda el menaje y un comensal con 'cena sin pescado salvo gambas'", async () => {
    const fetch = mockApi({
      "/api/proxy/coach/kitchen": (init) => ({ body: init?.method === "PUT" ? { ...KITCHEN, filled: true, ...JSON.parse(String(init.body)) } : KITCHEN }),
    });
    renderApp(<KitchenPage />, locale);
    const form = await screen.findByTestId("kitchen-form");
    expect(within(form).getByText(cat.equipment.pressure_cookers)).toBeTruthy();
    fireEvent.change(screen.getByTestId("kitchen-pots"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("kitchen-burners_large"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("kitchen-air_fryer"));
    fireEvent.change(await screen.findByTestId("kitchen-air_fryer_model"), { target: { value: "Cesta 5 l" } });
    fireEvent.click(screen.getByTestId("kitchen-add-diner"));
    fireEvent.change(screen.getByTestId("kitchen-diner-name"), { target: { value: "Pareja" } });
    const restriction = screen.getByTestId("kitchen-restriction");
    fireEvent.click(within(restriction).getByLabelText(CATALOGS[locale].menu.meals.dinner));
    fireEvent.change(screen.getByTestId("kitchen-exclude"), { target: { value: "pescado" } });
    fireEvent.change(screen.getByTestId("kitchen-allow"), { target: { value: "gambas" } });
    fireEvent.click(screen.getByTestId("kitchen-save"));
    await screen.findByTestId("kitchen-saved");
    const [, init] = fetch.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(JSON.parse(String(init!.body))).toEqual({
      equipment: { pots: 2, burners_large: 3, air_fryer: true, air_fryer_model: "Cesta 5 l" },
      diners: [{ name: "Pareja", restrictions: [{ meals: ["dinner"], exclude: ["pescado"], allow: ["gambas"] }] }],
    });
    await waitFor(() => expect(screen.getByTestId("kitchen-saved").textContent).toBe(cat.saved));
    // Las palabras de categoría son convención de FightLab, con su chip.
    expect(screen.getAllByTestId("evidence-chip").some((c) => c.dataset.variant === "convention")).toBe(true);
  });
});
