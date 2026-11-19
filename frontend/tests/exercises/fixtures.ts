import type { Exercise } from "@/lib/exercises";

export function ex(over: Partial<Exercise> & { key: string; name: string }): Exercise {
  return {
    aliases: [],
    primary_muscles: ["chest"],
    secondary_muscles: [],
    equipment: ["barbell"],
    category: "strength",
    images: [],
    instructions: [],
    instructions_lang: null,
    text_credit: null,
    notes: "",
    source: "fightlab",
    attribution: null,
    custom: false,
    ...over,
  };
}

export const BENCH = ex({
  key: "cat:barbell-bench-press",
  name: "Press banca",
  aliases: ["Bench press (barbell)", "press de banca", "Bench Press (Barbell)"],
  primary_muscles: ["chest"],
  secondary_muscles: ["triceps", "front_delts"],
  equipment: ["barbell", "bench"],
  images: [
    {
      url: "/exercise-media/barbell-bench-press-1.svg",
      source: "everkinetic",
      author: "Everkinetic",
      license: "CC BY-SA 4.0",
      license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
      source_url: "https://github.com/everkinetic/data",
      modified: "SVG minificado",
    },
    {
      url: "/exercise-media/barbell-bench-press-2.svg",
      source: "everkinetic",
      author: "Everkinetic",
      license: "CC BY-SA 4.0",
      license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
      source_url: "https://github.com/everkinetic/data",
      modified: "SVG minificado",
    },
  ],
  instructions: ["Lie on the bench.", "Lower the bar to the chest.", "Press it up."],
  instructions_lang: "en",
  text_credit: {
    source: "wger",
    author: "wger.de contributors",
    license: "CC BY-SA 4.0",
    license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
    source_url: "https://wger.de/en/exercise/73/view/",
  },
  source: "everkinetic+wger",
  attribution: "Everkinetic · CC BY-SA 4.0",
});

export const PULLDOWN = ex({
  key: "cat:lat-pulldown",
  name: "Jalón al pecho",
  aliases: ["Lat pulldown", "jalón dorsal"],
  primary_muscles: ["lats"],
  secondary_muscles: ["biceps"],
  equipment: ["cable", "machine"],
});

export const PUSHDOWN = ex({
  key: "cat:triceps-extension",
  name: "Extensión de tríceps",
  aliases: ["Triceps extension", "jalón de tríceps"],
  primary_muscles: ["triceps"],
  equipment: ["cable", "dumbbell"],
});

export const CRUNCH = ex({
  key: "cat:cable-crunch",
  name: "Crunch en polea",
  aliases: ["Cable crunch"],
  primary_muscles: ["abs"],
  equipment: ["cable"],
});

export const SHADOW = ex({
  key: "cat:shadow-boxing",
  name: "Sombra",
  aliases: ["Shadow boxing"],
  primary_muscles: ["full_body"],
  equipment: ["bodyweight"],
  category: "combat",
  instructions: ["Guardia alta.", "Golpea al aire."],
  instructions_lang: "es",
  text_credit: { source: "fightlab" },
});

export const MINE = ex({
  key: "custom:7",
  id: 7,
  name: "Remo Meadows",
  primary_muscles: ["upper_back"],
  equipment: ["barbell"],
  notes: "Barra en la esquina",
  source: "custom",
  custom: true,
});

export const LIST = [MINE, BENCH, PULLDOWN, PUSHDOWN, CRUNCH, SHADOW];
