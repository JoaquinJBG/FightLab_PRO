import { vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import type { Profile, Safety, Targets, WeighIn } from "@/lib/schemas";

export const CATALOGS = { es, en } as const;
export type Locale = keyof typeof CATALOGS;

export const PROFILE: Profile = {
  date_of_birth: "1996-05-01",
  gender: "MALE",
  height_cm: 175,
  dominant_stance: null,
  preferred_units: "METRIC",
  timezone: "UTC",
  equation_sex: null,
  goal: "maintenance",
  experience: "intermediate",
  activity_level: "desk_training",
  language: "es",
  region: "es",
  emergency_number: null,
  medications: [],
  medications_other: [],
  conditions: [],
  conditions_other: [],
  disciplines: [],
  training_frequency: null,
  goal_weight_kg: null,
  goal_date: null,
  weight_class: null,
  weigh_in_at: null,
};

export const SAFETY: Safety = {
  screened: true,
  flags: {},
  reasons: [],
  paused_exercises: {},
  refer_gp: false,
  deferral_line: null,
  disclaimer: "Esto es orientación general de un entrenador automatizado, no consejo médico.",
  emergency_number: "112",
  parq_pending: false,
  weight: { kg: 70, date: "2026-10-20" },
};

const RULE = (key: string, title: string, grade = "moderate") => ({ key, grade, title });

export const TARGETS: Targets = {
  blocked: null,
  goal: "maintenance",
  kcal: 2600,
  maintenance_kcal: 2600,
  deficit_kcal: 0,
  in_deficit: false,
  deficit_blocked: false,
  clamped: false,
  macros: { protein_g: 112, fat_g: 72.22, fat_min_g: 57.8, carbs_g: 372.5, fibre_g: 25, protein_g_per_kg: 1.6 },
  equation: {
    code: "ten_haaf",
    rmr_kcal: 1881.2,
    ffm_kg: null,
    pal: 1.675,
    activity_level: "desk_training",
    rule_key: "nutrition/trained-clients-cunningham-or-ten-haaf",
  },
  rules: {
    kcal: [
      RULE("nutrition/trained-clients-cunningham-or-ten-haaf", "Trained clients: Cunningham or ten Haaf"),
      RULE("nutrition/activity-multipliers-pal", "Activity multipliers (PAL)"),
    ],
    protein_g: [RULE("nutrition/daily-protein-target-for-people-who-lift", "Daily protein target for people who lift")],
    fat_g: [RULE("nutrition/minimum-dietary-fat", "Minimum dietary fat")],
    fibre_g: [RULE("nutrition/dietary-fibre", "Dietary fibre", "strong")],
  },
  reasons: [
    {
      code: "rmr_ten_haaf",
      rule_key: "nutrition/trained-clients-cunningham-or-ten-haaf",
      grade: "moderate",
      params: {},
      text: "ecuación de ten Haaf por peso, porque no hay una composición corporal reciente",
      professional: null,
      severity: "info",
    },
  ],
  weight: { kg: 70, date: "2026-10-20", stale_days: 9 },
  engine: { sha: "69e5537", knowledge_checked_on: "2026-10-24" },
};

export const WEIGH_IN: WeighIn = {
  blocked: false,
  deficit_blocked: false,
  reasons: [],
  goal_weight_kg: null,
  goal_date: null,
  weigh_in_at: null,
  weight_class: null,
  days_left: null,
  current_kg: 70,
  to_go_kg: null,
};

type Route = { status?: number; body?: unknown };
export type Routes = Record<string, Route | ((init?: RequestInit) => Route)>;

/** `fetch` que responde por ruta (`/api/proxy/…`, sin la barra final); lo no listado da 404.
 * Devuelve el mock para comprobar las llamadas. */
export function mockApi(routes: Routes) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split("?")[0];
    const route = routes[url];
    const r = typeof route === "function" ? route(init) : route;
    if (!r) return { ok: false, status: 404, json: async () => ({}) } as Response;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body ?? {} } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function renderApp(ui: React.ReactElement, locale: Locale = "es") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
          {ui}
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}
