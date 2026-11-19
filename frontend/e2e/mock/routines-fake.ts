import type { Page, Route } from "@playwright/test";

// Servidor de mentira en memoria para /gym/* (rutinas, carpetas, programas y ejercicios).

type Set = { set_type: string; reps: number | null; reps_max: number | null; weight_kg: number | null; rpe: number | null; rir: number | null };
type Ex = { exercise_key: string | null; name: string; notes: string; rest_s: number | null; superset: number | null; sets: Set[] };
type R = { id: number; title: string; notes: string; folder: number | null; order: number; source: string; source_ref: string; exercises: Ex[] };

const s = (reps: number, max: number | null, type = "normal"): Set => ({ set_type: type, reps, reps_max: max, weight_kg: null, rpe: null, rir: 2 });

const PROGRAM = {
  slug: "full-body-3", title: "Cuerpo completo, 3 días", description: "Tres sesiones de cuerpo completo.",
  days_per_week: 3, level: "beginner", source: "FightLab convention", source_note: "Estructura habitual.", convention: true,
  rules: [{ key: "strength-hypertrophy/full-body-versus-split", grade: "moderate", title: "Full-body versus split" }],
  routines: [{ key: "a", title: "Cuerpo completo A", exercise_count: 2 }],
};

const EXERCISES = [
  { key: "cat:barbell-back-squat", name: "Sentadilla", category: "strength", equipment: ["barbell"] },
  { key: "cat:barbell-bench-press", name: "Press banca", category: "strength", equipment: ["barbell", "bench"] },
  { key: "cat:face-pull", name: "Face pull", category: "strength", equipment: ["cable"] },
].map((e) => ({
  ...e, aliases: [], primary_muscles: ["chest"], secondary_muscles: [], images: [], instructions: [],
  instructions_lang: null, text_credit: null, notes: "", source: "fightlab", attribution: null, custom: false,
}));

export async function fakeGym(page: Page) {
  const state = { routines: [] as R[], folders: [] as { id: number; name: string; order: number; kind: string; program_slug: string }[], seq: 100 };
  const summary = (r: R) => ({
    id: r.id, title: r.title, notes: r.notes, folder: r.folder, order: r.order, source: r.source, source_ref: r.source_ref,
    exercise_count: r.exercises.length, set_count: r.exercises.reduce((n, e) => n + e.sets.length, 0),
    exercise_names: r.exercises.map((e) => e.name), exercise_keys: r.exercises.map((e) => e.exercise_key), updated_at: "2026-11-09T10:00:00Z",
  });
  const full = (r: R) => ({ ...r, exercises: r.exercises.map((e, i) => ({ ...e, id: i + 1, order: i })), created_at: "", updated_at: `u${state.seq}` });
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/proxy/gym/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/proxy\/gym\//, "");
    const body = req.postData() ? JSON.parse(req.postData()!) : {};
    if (path === "exercises") return json(route, EXERCISES);
    if (path === "programs") return json(route, [PROGRAM]);
    if (path === "programs/full-body-3/load") {
      const folder = { id: ++state.seq, name: PROGRAM.title, order: 0, kind: "program", program_slug: PROGRAM.slug };
      state.folders.push(folder);
      const r: R = {
        id: ++state.seq, title: "Cuerpo completo A", notes: "", folder: folder.id, order: 0, source: "program", source_ref: "full-body-3:a",
        exercises: [
          { exercise_key: "cat:barbell-back-squat", name: "Sentadilla", notes: "", rest_s: 150, superset: null, sets: [s(6, 10), s(6, 10), s(6, 10)] },
          { exercise_key: "cat:barbell-bench-press", name: "Press banca", notes: "", rest_s: 150, superset: null, sets: [s(6, 10), s(6, 10)] },
        ],
      };
      state.routines.push(r);
      return json(route, { folder: { ...folder, routine_count: 1 }, routines: [full(r)] }, 201);
    }
    if (path === "routine-folders") {
      return json(route, state.folders.map((f) => ({ ...f, routine_count: state.routines.filter((r) => r.folder === f.id).length })));
    }
    if (path === "routines") return json(route, state.routines.map(summary));
    const m = /^routines\/(\d+)$/.exec(path);
    if (m) {
      const r = state.routines.find((x) => x.id === Number(m[1]));
      if (!r) return json(route, {}, 404);
      if (req.method() === "PUT") {
        Object.assign(r, { title: body.title, notes: body.notes, folder: body.folder, exercises: body.exercises });
        state.seq += 1;
      }
      return json(route, full(r));
    }
    return json(route, { detail: "not mocked" }, 404);
  });
  return state;
}

