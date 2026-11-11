import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderEn } from "./i18nB-helpers";
import MmaPage from "@/app/(shell)/training/mma/page";
import GymPage from "@/app/(shell)/training/gym/page";
import { mergeHistory } from "@/lib/activity-history";
import { rejectedActivities, resetActivityUid, saveActivityNow, flushActivities, pendingQueueItems, type SyncItem } from "@/lib/activities";

// F17 (rama H): fallo F1 de raíz (el historial sale del servidor y guardar AÑADE) y F2 en la
// cola (el servidor rechaza con el motivo y no se pierde en silencio).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("@/lib/session-check", async (orig) => ({ ...(await orig<typeof import("@/lib/session-check")>()), useSessionCheck: () => ({ data: undefined }) }));
vi.mock("@/lib/hooks", () => ({ useSafety: () => ({ data: undefined }), useBiometrics: () => ({ data: [] }) }));
vi.mock("@/lib/combat", async (orig) => ({
  ...(await orig<typeof import("@/lib/combat")>()),
  useHeadImpacts: () => ({ data: [] }),
  useReportHeadImpact: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useClearContact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/user-state", () => ({ useUserState: (_k: string, d: unknown) => ({ value: d, setValue: vi.fn() }) }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const serverMma = (i: number) => ({
  id: i, client_id: `srv-mma-${i}`, kind: "MMA", title: "Boxeo", started_at: new Date(Date.now() - (i + 1) * 86400_000).toISOString(),
  duration_sec: 3600, rpe: 6, kcal: null, note: "", detail: { art: "Boxeo", work_type: "Sparring", partner: null },
  load_au: 360, source: "MANUAL", created_at: "", summary: null,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  resetActivityUid();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("mergeHistory", () => {
  const it_ = (id: string, ts: number) => ({ client_id: id, ts });
  it("con servidor no se mezcla la caché local; sin servidor, sí", () => {
    const local = [it_("l", 5)];
    expect(mergeHistory({ server: [it_("s", 1)], pending: [], added: [], local }).map((x) => x.client_id)).toEqual(["s"]);
    expect(mergeHistory({ server: null, pending: [], added: [], local }).map((x) => x.client_id)).toEqual(["l"]);
  });
  it("lo añadido y lo pendiente van encima, sin duplicar, y lo oculto no sale", () => {
    const merged = mergeHistory({
      server: [it_("a", 1), it_("b", 2)], pending: [it_("c", 3)], added: [it_("c", 3), it_("d", 4)], local: [],
      hidden: new Set(["a"]),
    });
    expect(merged.map((x) => x.client_id)).toEqual(["d", "c", "b"]);
  });
});

describe("F1: guardar una sesión de MMA no vacía el historial", () => {
  it("con la caché local vacía, las 9 del servidor siguen tras guardar (10 en total)", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/activities?kind=MMA")) return json(Array.from({ length: 9 }, (_, i) => serverMma(i)));
      if (url.includes("/me")) return json({ id: 1 });
      return json({ results: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEn(<MmaPage />);
    await waitFor(() => expect(screen.getAllByText(/Sparring/).length).toBeGreaterThanOrEqual(9));
    const before = document.querySelectorAll(".glass.p-3\\.5").length;
    expect(before).toBe(9);
    fireEvent.click(screen.getByText("Save session"));
    expect(document.querySelectorAll(".glass.p-3\\.5").length).toBe(10);
  });

  it("«ver más» pide la página siguiente", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes("offset=0")) return json(Array.from({ length: 50 }, (_, i) => serverMma(i)));
      if (url.includes("offset=50")) return json([serverMma(50)]);
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEn(<MmaPage />);
    fireEvent.click(await screen.findByText("Show more sessions"));
    await waitFor(() => expect(document.querySelectorAll(".glass.p-3\\.5").length).toBe(51));
    expect(screen.queryByText("Show more sessions")).toBeNull();
  });
});

describe("Gimnasio: historial y calendario del servidor", () => {
  it("las sesiones del servidor (también las importadas) salen con su resumen y su enlace al detalle", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/activities/calendar")) return json({ month: "2026-11", days: {} });
      if (url.includes("/activities?kind=GYM")) return json([{
        id: 42, client_id: "hevy_csv:2026-11-03T18:00:00", kind: "GYM", title: "Push A", started_at: new Date(Date.now() - 86400_000).toISOString(),
        duration_sec: 3600, rpe: null, kcal: null, note: "", detail: { import: { source: "hevy_csv" } }, load_au: null, source: "IMPORT",
        created_at: "", summary: { exercises: 2, sets: 7, volume_kg: 3120.5 },
      }]);
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEn(<GymPage />);
    const link = await screen.findByRole("link", { name: /Push A/ });
    expect(link.getAttribute("href")).toBe("/training/gym/history/42");
    expect(link.textContent).toContain("2 exercises · 7 sets · 3,121 kg");
    expect(screen.getByTestId("training-calendar")).toBeTruthy();
  });
});

describe("F2: el servidor dice por qué no guarda", () => {
  const item: SyncItem = { client_id: "cid-f2-0001", kind: "GYM", title: "Pierna", started_at: new Date().toISOString(), duration_sec: 600 };

  it("400 al guardar: motivo y fuera de la cola", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "invalid", errors: { sets: [{ weight_kg: ["≤ 1000"] }] } }, 400)));
    const r = await saveActivityNow(item);
    expect(r).toEqual({ status: "invalid", errors: { sets: [{ weight_kg: ["≤ 1000"] }] } });
    expect(pendingQueueItems("GYM")).toHaveLength(0);
  });

  it("sin red: se queda en la cola para subirla después", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await saveActivityNow(item)).toEqual({ status: "queued" });
    expect(pendingQueueItems("GYM").map((i) => i.client_id)).toEqual(["cid-f2-0001"]);
  });

  it("la cola apunta lo rechazado con su motivo", async () => {
    localStorage.setItem("flp_pending_acts_anon", JSON.stringify([item]));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/me")) return json({ id: 1 });
      return json({ results: [{ client_id: "cid-f2-0001", status: "invalid", errors: { started_at: ["Fecha en el futuro."] } }] });
    }));
    expect(await flushActivities()).toBe(true);
    expect(rejectedActivities("GYM")).toEqual([expect.objectContaining({ client_id: "cid-f2-0001", errors: { started_at: ["Fecha en el futuro."] } })]);
  });
});
