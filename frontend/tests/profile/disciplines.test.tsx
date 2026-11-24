import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ProfilePage from "@/app/(shell)/profile/page";
import ImportHubPage from "@/app/(shell)/profile/import-hub/page";
import TrainingHubPage from "@/app/(shell)/training/page";
import TodayPage from "@/app/(shell)/today/page";
import DashboardPage from "@/app/(shell)/dashboard/page";
import type { TodayState } from "@/lib/today";
import { CATALOGS, PROFILE, SAFETY, WEIGH_IN, mockApi, renderApp } from "../support/app";

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

afterEach(() => vi.unstubAllGlobals());

const PROFILE_URL = "/api/proxy/me/profile";
const profileWith = (over: { show_gym?: boolean; show_combat?: boolean }) => ({ [PROFILE_URL]: { body: { ...PROFILE, ...over } } });

const PLAN = { id: 3, week_start: "2026-10-26", type: "gym", entries: [{ kind: "gym", time: "18:00", session: "A", exercises: ["Sentadilla", "Press banca"] }] };

const DAY = {
  date: "2026-10-29", today: "2026-10-29", weekday: "thu", plan: PLAN, day_type: "gym", day_type_set: false, trained: null,
  mobility: null, weight_kg: null, weight_blocked: false, menu: null, next_meal: null,
  cardio: { sessions: [], week: { start: "2026-10-26", minutes: 0, equivalent: 0, goal: 150, mma_minutes: 0, mma_convention: null, rule_key: "cardio-health/weekly-baseline-dose", grade: "strong", vigorous_rule_key: "cardio-health/0-10-effort-scale-and-talk-test-anchors", vigorous_grade: "moderate" }, types: [] },
} as unknown as TodayState;

describe("Perfil: «Qué entrenas»", () => {
  it("dos interruptores accesibles, encendidos de primera, con su pista", () => {
    mockApi(profileWith({}));
    renderApp(<ProfilePage />);
    const gym = screen.getByRole("switch", { name: "Gimnasio" });
    const combat = screen.getByRole("switch", { name: "Entrenamiento de contacto (MMA, boxeo…)" });
    expect(gym.getAttribute("aria-checked")).toBe("true");
    expect(combat.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Ocultan lo que no usas. Puedes volver a activarlos cuando quieras.")).toBeTruthy();
  });

  it("refleja lo guardado en el servidor", async () => {
    mockApi(profileWith({ show_gym: false }));
    renderApp(<ProfilePage />);
    await waitFor(() => expect(screen.getByTestId("switch-gym").getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByTestId("switch-combat").getAttribute("aria-checked")).toBe("true");
  });

  it("al pulsar cambia al momento y guarda con PATCH solo ese campo", async () => {
    const fetchMock = mockApi({
      [PROFILE_URL]: (init) => ({ body: init?.method === "PATCH" ? { ...PROFILE, show_gym: false, show_combat: false } : { ...PROFILE, show_gym: false } }),
    });
    renderApp(<ProfilePage />);
    await waitFor(() => expect(screen.getByTestId("switch-gym").getAttribute("aria-checked")).toBe("false")); // ya cargó
    fireEvent.click(screen.getByTestId("switch-combat"));
    // optimista: cambia sin esperar a la respuesta del servidor
    await waitFor(() => expect(screen.getByTestId("switch-combat").getAttribute("aria-checked")).toBe("false"));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ show_combat: false });
    });
    expect(screen.getByTestId("switch-gym").getAttribute("aria-checked")).toBe("false");
  });

  it("si el guardado falla, vuelve atrás y avisa", async () => {
    mockApi({
      [PROFILE_URL]: (init) => (init?.method === "PATCH" ? { status: 500, body: { detail: "boom" } } : { body: PROFILE }),
    });
    renderApp(<ProfilePage />);
    await waitFor(() => expect(screen.getByTestId("switch-gym").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByTestId("switch-gym"));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe("No se pudo guardar el cambio.");
    expect(screen.getByTestId("switch-gym").getAttribute("aria-checked")).toBe("true");
  });

  it("en inglés", () => {
    mockApi(profileWith({}));
    renderApp(<ProfilePage />, "en");
    expect(screen.getByRole("switch", { name: "Gym" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Contact training (MMA, boxing…)" })).toBeTruthy();
  });
});

describe("Entreno: qué se oculta", () => {
  const hrefs = (c: HTMLElement) => Array.from(c.querySelectorAll("a")).map((a) => a.getAttribute("href"));

  it("sin gimnasio ni contacto: el Historial también se va", async () => {
    mockApi(profileWith({ show_gym: false, show_combat: false }));
    renderApp(<TrainingHubPage />);
    await waitFor(() => expect(screen.queryByTestId("hub-gym")).toBeNull());
    expect(screen.queryByTestId("hub-history")).toBeNull();
    expect(screen.getByTestId("hub-sports")).toBeTruthy();
  });

  it("por defecto ve todo", async () => {
    mockApi({ ...profileWith({}), "/api/proxy/coach/today": { body: DAY } });
    renderApp(<TrainingHubPage />);
    for (const id of ["gym", "mma", "sports", "history", "week", "routines"]) expect(screen.getByTestId(`hub-${id}`)).toBeTruthy();
  });

  it("sin gimnasio: fuera Gimnasio y Mis rutinas; Historial sigue (hay combate); Mi semana a ancho completo", async () => {
    mockApi(profileWith({ show_gym: false }));
    renderApp(<TrainingHubPage />);
    await waitFor(() => expect(screen.queryByTestId("hub-gym")).toBeNull());
    expect(screen.getByTestId("hub-history").getAttribute("href")).toBe("/training/history");
    expect(screen.queryByTestId("hub-routines")).toBeNull();
    expect(screen.getByTestId("hub-mma")).toBeTruthy();
    expect(screen.getByTestId("hub-sports")).toBeTruthy();
    expect(screen.getByTestId("hub-week").parentElement!.className).toContain("grid-cols-1");
    expect(screen.getByTestId("hub-mma").parentElement!.className).toContain("grid-cols-2");
  });

  it("sin contacto: fuera MMA, el resto sigue", async () => {
    mockApi(profileWith({ show_combat: false }));
    renderApp(<TrainingHubPage />);
    await waitFor(() => expect(screen.queryByTestId("hub-mma")).toBeNull());
    for (const id of ["gym", "sports", "history", "week", "routines"]) expect(screen.getByTestId(`hub-${id}`)).toBeTruthy();
  });

  it("sin gimnasio, «Hoy toca» deja el texto de la sesión pero sin Empezar", async () => {
    mockApi({ ...profileWith({ show_gym: false }), "/api/proxy/coach/today": { body: DAY } });
    renderApp(<TrainingHubPage />);
    await screen.findByTestId("hub-today");
    await waitFor(() => expect(screen.queryByTestId("hub-gym")).toBeNull());
    expect(screen.getByText(/Gimnasio/, { selector: "li" })).toBeTruthy();
    expect(screen.queryByTestId("hub-today-start")).toBeNull();
  });

  it("con ambos apagados la página sigue entera (Deporte y Mi semana)", async () => {
    mockApi(profileWith({ show_gym: false, show_combat: false }));
    const { container } = renderApp(<TrainingHubPage />);
    await waitFor(() => expect(screen.queryByTestId("hub-mma")).toBeNull());
    expect(hrefs(container)).toEqual(expect.arrayContaining(["/training/sports", "/training/plan", "/training/tools"]));
    expect(hrefs(container)).not.toContain("/training/gym");
  });
});

describe("Hoy, Progreso e Importar", () => {
  it("Hoy: sin gimnasio el texto de la sesión sigue y el botón Empezar no", async () => {
    mockApi({ ...profileWith({ show_gym: false }), "/api/proxy/coach/today": { body: DAY } });
    renderApp(<TodayPage />);
    const plan = await screen.findByTestId("day-plan");
    expect(plan.textContent).toContain("Gimnasio, sesión A");
    await waitFor(() => expect(screen.queryByRole("link", { name: /Empezar la sesión A/ })).toBeNull());
  });

  it("Hoy: con gimnasio, el botón Empezar está", async () => {
    mockApi({ ...profileWith({}), "/api/proxy/coach/today": { body: DAY } });
    renderApp(<TodayPage />);
    expect(await screen.findByRole("link", { name: /Empezar la sesión A/ })).toBeTruthy();
  });

  it("Progreso: sin gimnasio no hay mosaico de Récords; con él, sí", async () => {
    const routes = (over: { show_gym?: boolean }) => ({
      "/api/proxy/me": { body: { id: 1, email: "ana@fightlab.test", is_email_verified: true } },
      "/api/proxy/me/biometrics": { body: [] },
      "/api/proxy/coach/safety": { body: SAFETY },
      "/api/proxy/coach/weigh-in": { body: WEIGH_IN },
      ...profileWith(over),
    });
    const { tiles } = CATALOGS.es.dashboard;
    mockApi(routes({ show_gym: false }));
    const first = renderApp(<DashboardPage />);
    await screen.findByTestId("measures-card");
    await waitFor(() => expect(screen.queryByRole("link", { name: new RegExp(tiles.records) })).toBeNull());
    expect(screen.getByRole("link", { name: new RegExp(tiles.review) })).toBeTruthy();
    first.unmount();
    mockApi(routes({}));
    renderApp(<DashboardPage />);
    await screen.findByTestId("measures-card");
    expect(screen.getByRole("link", { name: new RegExp(tiles.records) })).toBeTruthy();
  });

  it("Importar datos: sin gimnasio no sale «Entrenos de Hevy»", async () => {
    mockApi(profileWith({ show_gym: false }));
    renderApp(<ImportHubPage />);
    await waitFor(() => expect(screen.queryByText("Entrenos de Hevy")).toBeNull());
    expect(screen.getByText("Historial")).toBeTruthy();
    expect(screen.getByText("Catálogo del súper")).toBeTruthy();
  });
});
