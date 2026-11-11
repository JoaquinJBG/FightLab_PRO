import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import MenuPage from "@/app/(shell)/nutrition/menu/page";
import MyAiPage from "@/app/(shell)/profile/my-ai/page";
import { buildPrompt, contextUrl, copyLater, menuOrigin, type MenuContext } from "@/lib/menu-ai";
import { CATALOGS, mockApi, renderApp } from "../support/app";
import { IMPORTED_MENU, importedState } from "../support/menu-f12";

// Fase 14: menús con la IA del usuario. Vía C (copiar el contexto y pegar el JSON de vuelta) y la
// pantalla Perfil → Mi IA con los tokens de la skill (vía B). Datos inventados.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONTEXT: MenuContext = {
  context_version: 1,
  lang: "es",
  request: { start: "2026-11-02", end: "2026-11-04", days: 3, meals: ["breakfast", "lunch"], tupper_meals: ["lunch"], id: "ia-2026-11-02" },
  targets: { kcal: 2600, protein_g: 112, fat_min_g: 57.8, fibre_g: 25 },
  foods_columns: ["name", "per", "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"],
  foods: [["copos de avena", "100 g", 379, 13.2, 67.7, 6.5, 10.1]],
  instructions: "Eres el planificador de menús de FightLab. Responde SOLO con un JSON schema: 1.",
};

const AI_REPLY = '```json\n{"schema": 1, "days": []}\n```';

function stubClipboard(writeText = vi.fn(async () => {})) {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}

const pasted = (menu = { ...IMPORTED_MENU, source: "user_ai" as const, origin: "user_ai" as const }) => ({
  summary: { menu_id: "ia-2026-11-02", title: "Menú de mi IA", start: "2026-11-02", end: "2026-11-04", days: 3, dishes: 3, batch_sessions: 0, shopping_items: 0, source: "user_ai" },
  replaced: false,
  kept_checks: 0,
  checked: true,
  days_ok: 2,
  days_failing: ["2026-11-04"],
  menu,
});

const routes = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  "/api/proxy/coach/menu": { body: importedState() },
  "/api/proxy/coach/products": { body: { products: [] } },
  "/api/proxy/coach/tickets": { body: { enabled: false, max_upload_mb: 2, tickets: [] } },
  "/api/proxy/coach/menu/context": { body: CONTEXT },
  ...extra,
});

describe("texto para la IA", () => {
  it("pone las instrucciones y debajo los datos en JSON, sin repetirlas", () => {
    const text = buildPrompt(CONTEXT, "Datos (JSON):");
    expect(text.startsWith(CONTEXT.instructions)).toBe(true);
    const json = text.slice(text.indexOf("```json\n") + 8, text.lastIndexOf("\n```"));
    const data = JSON.parse(json);
    expect(data.instructions).toBeUndefined();
    expect(data.request.id).toBe("ia-2026-11-02");
    expect(data.foods[0][0]).toBe("copos de avena");
  });

  it("pide el contexto con los días y comidas del formulario", () => {
    expect(contextUrl({ days: 3, meals: ["breakfast", "lunch"], tupper: ["lunch"] })).toBe(
      "/api/proxy/coach/menu/context?days=3&meals=breakfast%2Clunch&tupper=lunch",
    );
    expect(contextUrl({ days: 7, meals: ["dinner"], tupper: [] })).toBe("/api/proxy/coach/menu/context?days=7&meals=dinner");
  });

  it("dice el origen de cada menú", () => {
    expect(menuOrigin("user_ai")).toBe("user_ai");
    expect(menuOrigin("generated")).toBe("auto");
    expect(["json", "yaml", "partediario"].map(menuOrigin)).toEqual(["import", "import", "import"]);
  });

  it("sin portapapeles, devuelve el texto para copiarlo a mano", async () => {
    stubClipboard(vi.fn(async () => { throw new Error("denied"); }));
    expect(await copyLater(Promise.resolve("hola"))).toEqual({ text: "hola", copied: false });
  });
});

describe.each(["es", "en"] as const)("Prepararlo con mi IA (%s)", (locale) => {
  const cat = CATALOGS[locale].menu.ai;

  it("copia las instrucciones y los datos del menú pedido", async () => {
    const writeText = stubClipboard();
    const fetch = mockApi(routes());
    renderApp(<MenuPage />, locale);
    fireEvent.click(await screen.findByTestId("menu-ai-copy"));
    const status = await screen.findByTestId("menu-ai-copied");
    expect(status.textContent).toContain("2026-11-02");
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text.startsWith(CONTEXT.instructions)).toBe(true);
    expect(text).toContain(cat.dataTitle);
    const call = fetch.mock.calls.find(([u]) => String(u).startsWith("/api/proxy/coach/menu/context"));
    expect(String(call![0])).toContain("days=3&meals=breakfast%2Clunch%2Cdinner%2Csnack");
  });

  it("si no puede copiar, enseña el texto para copiarlo a mano", async () => {
    stubClipboard(vi.fn(async () => { throw new Error("denied"); }));
    mockApi(routes());
    renderApp(<MenuPage />, locale);
    fireEvent.click(await screen.findByTestId("menu-ai-copy"));
    const box = (await screen.findByTestId("menu-ai-prompt")) as HTMLTextAreaElement;
    expect(box.value.startsWith(CONTEXT.instructions)).toBe(true);
    expect(screen.getByText(cat.copyManual)).toBeTruthy();
  });

  it("pegar un JSON válido lo guarda y dice qué días no cuadran", async () => {
    const fetch = mockApi(routes({ "/api/proxy/coach/menu/paste": { status: 201, body: pasted() } }));
    renderApp(<MenuPage />, locale);
    const area = await screen.findByTestId("menu-ai-paste");
    fireEvent.change(area, { target: { value: AI_REPLY } });
    fireEvent.click(screen.getByTestId("menu-ai-save"));
    const done = await screen.findByTestId("menu-ai-done");
    expect(done.dataset.failing).toBe("1");
    expect(done.textContent).toContain("Menú de mi IA");
    expect(done.textContent).toContain("2026-11-04");
    const post = fetch.mock.calls.find(([u]) => String(u) === "/api/proxy/coach/menu/paste");
    expect(JSON.parse(String(post![1]!.body))).toEqual({ menu: AI_REPLY });
    expect((area as HTMLTextAreaElement).value).toBe("");
  });

  it("un JSON roto da un error claro con la línea y la columna", async () => {
    mockApi(routes({
      "/api/proxy/coach/menu/paste": {
        status: 400,
        body: { code: "paste_not_json", detail: "x", info: "line 1, column 24: Expecting value", params: { line: 1, column: 24 } },
      },
    }));
    renderApp(<MenuPage />, locale);
    fireEvent.change(await screen.findByTestId("menu-ai-paste"), { target: { value: '{"schema": 1, "days": [}' } });
    fireEvent.click(screen.getByTestId("menu-ai-save"));
    const error = await screen.findByTestId("menu-ai-error");
    expect(error.dataset.code).toBe("paste_not_json");
    expect(error.textContent).toContain(cat.errors.paste_not_json.replace("{line}", "1").replace("{column}", "24"));
    expect(error.textContent).toContain(cat.askAgain);
  });

  it("un JSON que no es un menú dice dónde falla", async () => {
    mockApi(routes({
      "/api/proxy/coach/menu/paste": { status: 400, body: { code: "import_invalid", detail: "x", info: "2026-11-02: dish_id D9", params: {} } },
    }));
    renderApp(<MenuPage />, locale);
    fireEvent.change(await screen.findByTestId("menu-ai-paste"), { target: { value: '{"schema": 1}' } });
    fireEvent.click(screen.getByTestId("menu-ai-save"));
    const error = await screen.findByTestId("menu-ai-error");
    expect(error.textContent).toContain(cat.errors.import_invalid);
    expect(error.textContent).toContain("2026-11-02: dish_id D9");
  });

  it("si otro menú empieza ese día, pide confirmación y lo sustituye", async () => {
    let calls = 0;
    const fetch = mockApi(routes({
      "/api/proxy/coach/menu/paste": () => (++calls === 1
        ? { status: 409, body: { code: "start_taken", detail: "x", info: "2026-11-02", params: {} } }
        : { status: 201, body: pasted() }),
    }));
    renderApp(<MenuPage />, locale);
    fireEvent.change(await screen.findByTestId("menu-ai-paste"), { target: { value: AI_REPLY } });
    fireEvent.click(screen.getByTestId("menu-ai-save"));
    const confirm = await screen.findByTestId("menu-ai-confirm");
    expect(confirm.textContent).toContain(cat.startTaken);
    fireEvent.click(within(confirm).getByRole("button"));
    await screen.findByTestId("menu-ai-done");
    const posts = fetch.mock.calls.filter(([u]) => String(u) === "/api/proxy/coach/menu/paste");
    expect(JSON.parse(String(posts[1][1]!.body))).toEqual({ menu: AI_REPLY, replace_start: true });
  });

  it("la cabecera dice el origen del menú", async () => {
    mockApi(routes({ "/api/proxy/coach/menu": { body: importedState({ menu: { ...IMPORTED_MENU, source: "user_ai", origin: "user_ai" } }) } }));
    renderApp(<MenuPage />, locale);
    const badge = await screen.findByTestId("menu-origin");
    expect(badge.dataset.origin).toBe("user_ai");
    expect(badge.textContent).toBe(CATALOGS[locale].menu.header.origin.user_ai);
  });

  it("un menú automático se etiqueta como automático", async () => {
    mockApi(routes({ "/api/proxy/coach/menu": { body: importedState({ menu: { ...IMPORTED_MENU, source: "generated", provider: "fake" } }) } }));
    renderApp(<MenuPage />, locale);
    const badge = await screen.findByTestId("menu-origin");
    expect(badge.dataset.origin).toBe("auto");
    expect(badge.textContent).toBe(CATALOGS[locale].menu.header.origin.auto);
  });
});

describe.each(["es", "en"] as const)("Perfil → Mi IA (%s)", (locale) => {
  const cat = CATALOGS[locale].myAi;
  const row = { id: 4, name: "PC de casa", prefix: "flm_abc123", created_at: "2026-11-01T10:00:00Z", last_used_at: null, scope: ["menu:context", "menu:import"] };

  it("crea un token, lo enseña una vez y lo revoca en dos toques", async () => {
    let list = [] as (typeof row)[];
    const fetch = mockApi({
      "/api/proxy/coach/menu-tokens": (init) => {
        if (init?.method === "POST") {
          list = [row];
          return { status: 201, body: { ...row, token: "flm_SECRET-only-once-1234567890" } };
        }
        return { body: { tokens: list, max: 5 } };
      },
      "/api/proxy/coach/menu-tokens/4": () => {
        list = [];
        return { status: 204 };
      },
    });
    renderApp(<MyAiPage />, locale);
    expect(await screen.findByText(cat.tokens.none)).toBeTruthy();
    expect(screen.getByTestId("my-ai-url").textContent).toBe(`${window.location.origin}/api/ext`);
    fireEvent.change(screen.getByTestId("my-ai-name"), { target: { value: "PC de casa" } });
    fireEvent.click(screen.getByTestId("my-ai-create"));
    expect((await screen.findByTestId("my-ai-token-value")).textContent).toBe("flm_SECRET-only-once-1234567890");
    expect(screen.getByText(cat.tokens.once)).toBeTruthy();
    const item = await screen.findByTestId("my-ai-token");
    expect(item.textContent).toContain("flm_abc123…");
    expect(item.textContent).not.toContain("SECRET");
    fireEvent.click(within(item).getByTestId("my-ai-revoke"));
    fireEvent.click(within(item).getByTestId("my-ai-revoke-confirm"));
    await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => String(u) === "/api/proxy/coach/menu-tokens/4" && i?.method === "DELETE")).toBe(true));
    await screen.findByText(cat.tokens.none);
  });
});
