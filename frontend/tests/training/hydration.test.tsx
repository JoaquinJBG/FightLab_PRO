import { describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import TrainingHubPage from "@/app/(shell)/training/page";
import LoadPage from "@/app/(shell)/training/load/page";

// F14 de la prueba en móvil: error de hidratación #418 en /training y /training/load. El servidor
// pinta la carga vacía (no tiene localStorage) y el cliente la pintaba ya con la de localStorage.

const state = vi.hoisted(() => ({ metrics: null as unknown }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/lib/hooks", () => ({ useBiometrics: () => ({ data: [] }), useSafety: () => ({ data: undefined }) }));
vi.mock("@/lib/activities", () => ({ fetchServerMetrics: vi.fn(async () => null) }));
vi.mock("@/lib/load", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/load")>()),
  loadMetrics: () => state.metrics,
}));

const m = (over: object) => ({
  weekAU: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, weekVsAvgPct: null, ratioDaysLeft: 28, gaps: false,
  monotonia: null, tension: null, sinVariacion: false, historyDays: 0, ...over,
});

const wrap = (ui: ReactElement) => <NextIntlClientProvider locale="es" messages={es} timeZone="Europe/Madrid">{ui}</NextIntlClientProvider>;

/** HTML del servidor sin datos locales; luego el cliente hidrata con datos en localStorage. */
async function hydrationErrors(ui: ReactElement): Promise<unknown[]> {
  state.metrics = m({}); // en el servidor no hay localStorage
  const html = renderToString(wrap(ui));
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  state.metrics = m({ weekAU: 420, daily7: [0, 60, 0, 120, 0, 240, 0], historyDays: 12, ratioDaysLeft: 16 });
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(host, wrap(ui), { onRecoverableError: (e) => errors.push(e) });
  });
  // Tras montar sí se ven los datos locales
  expect(host.textContent).toContain("420");
  act(() => root?.unmount());
  host.remove();
  return errors;
}

describe("sin error de hidratación (F14)", () => {
  it("/training", async () => {
    expect(await hydrationErrors(<TrainingHubPage />)).toEqual([]);
  });

  it("/training/load", async () => {
    expect(await hydrationErrors(<LoadPage />)).toEqual([]);
  });
});
