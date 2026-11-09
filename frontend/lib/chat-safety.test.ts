import { describe, test, expect } from "vitest";
import { createTranslator } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import { buildBriefing, buildRecs, coachReply, HEAD_BLOW_RULES, injuryAreas, type CoachTr, type Ctx, type Tr } from "./coach-rules";
import { detectSafetyTopic } from "./chat-safety";
import { COMBAT_RULES } from "./combat-rules";
import { SAFETY_RULES } from "./safety-rules";
import { ruleCitations } from "./load-texts";
import type { LoadMetrics } from "./load";

// F3: el chat por reglas contestaba «dale duro hoy» a «me duele la rodilla después del sparring».
// Las mismas frases están en `backend/ai/tests/test_chat_safety.py` (la lista gemela del servidor).

const translators = (messages: typeof es, locale: "es" | "en"): CoachTr => {
  const tr = (ns: "coach" | "load" | "combat") => createTranslator({ locale, messages, namespace: ns }) as unknown as Tr;
  return { t: tr("coach"), tl: tr("load"), tc: tr("combat") };
};
const TR_ES = translators(es, "es");
const TR_EN = translators(en as unknown as typeof es, "en");
const listEs = new Intl.ListFormat("es", { type: "conjunction" });
const listEn = new Intl.ListFormat("en", { type: "conjunction" });

// El peor caso: recuperación por encima de la media y carga normal, que daba «dale duro hoy».
const ready: LoadMetrics = {
  weekAU: 400, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: 1.2, weekVsAvgPct: 20, ratioDaysLeft: 0, gaps: false,
  monotonia: 1.2, tension: 100, sinVariacion: false, band: null, historyDays: 28,
};
const ctx: Ctx = {
  metrics: ready,
  recovery: {
    state: "listo", label: "", phrase: "", color: "#43e8a0", chips: ["FC en reposo −3"],
    signals: { rhrDelta: -3, hrvPct: null }, rhrDelta: -3,
  },
  weight: null, lastWeightDays: null, weighTarget: null, weighDays: null, cutAllowed: true, minor: false,
};

const PHRASES = {
  pain: [
    "me duele la rodilla después del sparring, ¿entreno hoy?",
    "Me duele el hombro",
    "tengo dolor en la espalda, ¿puedo entrenar fuerte?",
    "creo que me he lesionado el tobillo",
    "Me he hecho daño en la muñeca entrenando",
    "tengo una lesión en el codo",
    "me torcí el tobillo ayer",
    "noto un tirón en el isquio",
    "tengo molestias en la rodilla",
    "my knee hurts after sparring, should I train hard today?",
    "I have pain in my shoulder",
    "I think I injured my ankle",
    "I sprained my wrist yesterday",
    "my back is sore and stiff",
    "I pulled a muscle in my leg",
  ],
  headBlow: [
    "me dieron un golpe en la cabeza en el sparring",
    "Recibí un golpe fuerte en la cabeza, ¿entreno hoy?",
    "me duele la cabeza después del sparring",
    "creo que tengo una conmoción",
    "me noquearon ayer",
    "I took a hit to the head in sparring",
    "I got knocked out last night",
    "I have a headache after sparring, can I train hard today?",
    "could it be a concussion?",
  ],
  cardiac: [
    "me mareo cuando entreno fuerte",
    "estoy mareado, ¿entreno hoy?",
    "tengo dolor en el pecho al correr",
    "me desmayé en el entreno",
    "noto palpitaciones",
    "I feel dizzy, can I train hard today?",
    "I get chest pain when I run",
    "I nearly fainted at training",
    "I'm short of breath at rest",
  ],
  illness: [
    "tengo fiebre, ¿entreno hoy?",
    "creo que tengo la gripe",
    "I have a fever, should I train today?",
    "I think I have the flu",
  ],
} as const;

const NOT_SAFETY = [
  "¿entreno fuerte hoy?",
  "¿cómo va mi carga?",
  "cómo voy",
  "¿cómo va mi peso?",
  "tengo agujetas",
  "no me duele nada, ¿entreno fuerte hoy?",
  "sin dolor, ¿entreno fuerte hoy?",
  "should I train hard today?",
  "what is my strain this week?",
  "I'm pain-free, should I train hard today?",
  "gracias",
];

const GO_HARD = /dale duro|go hard|tienes margen|you have room|día normal de plan|normal plan day/i;

describe("detección de mensajes de seguridad (es y en)", () => {
  for (const [topic, phrases] of Object.entries(PHRASES)) {
    for (const phrase of phrases) {
      test(`«${phrase}» → ${topic}`, () => expect(detectSafetyTopic(phrase)).toBe(topic));
    }
  }
  for (const phrase of NOT_SAFETY) {
    test(`«${phrase}» no es un mensaje de seguridad`, () => expect(detectSafetyTopic(phrase)).toBeNull());
  }
});

describe("el chat por reglas no anima a entrenar con dolor, golpe en la cabeza o mareo", () => {
  test("el caso de la prueba en móvil ya no dice «dale duro»", () => {
    const reply = coachReply("me duele la rodilla después del sparring, ¿entreno hoy?", ctx, TR_ES, listEs);
    expect(reply).not.toMatch(GO_HARD);
    expect(reply).toMatch(/para y ve a un médico/);
    expect(reply).toContain(`[[regla:${SAFETY_RULES.newPain.key}]]`);
  });

  test("sin el mensaje de dolor, el mismo contexto sigue respondiendo con la carga", () => {
    expect(coachReply("¿entreno fuerte hoy?", ctx, TR_ES, listEs)).toMatch(/dale duro/);
  });

  const expected = {
    pain: [SAFETY_RULES.newPain],
    headBlow: [COMBAT_RULES.stopAfterHeadBlow, COMBAT_RULES.redFlags],
    cardiac: [SAFETY_RULES.cardiac],
    illness: [SAFETY_RULES.illness],
  } as const;

  for (const [topic, phrases] of Object.entries(PHRASES) as [keyof typeof expected, readonly string[]][]) {
    test(`${topic}: nunca un consejo de carga y siempre su regla con evidencia, en los dos idiomas`, () => {
      for (const phrase of phrases) {
        for (const [tr, list] of [[TR_ES, listEs], [TR_EN, listEn]] as const) {
          const reply = coachReply(phrase, ctx, tr, list);
          expect(reply, phrase).not.toMatch(GO_HARD);
          for (const rule of expected[topic]) expect(reply, phrase).toContain(`[[regla:${rule.key}]]`);
          // El chip sale con su grado (la página pasa estas citas a CitedText)
          expect(ruleCitations(reply).map((c) => c.key)).toEqual(expected[topic].map((r) => r.key));
        }
      }
    });
  }

  test("el golpe en la cabeza manda parar y no hacer contacto; el mareo, al médico", () => {
    expect(coachReply("me dieron un golpe en la cabeza", ctx, TR_ES, listEs)).toMatch(/no entrenes[^]*Nada de sparring/);
    expect(coachReply("I feel dizzy", ctx, TR_EN, listEn)).toMatch(/Stop and do not train today/);
  });
});

describe("F26: golpe en la cabeza activo y lesiones guardadas", () => {
  const blow: Ctx = { ...ctx, noContact: true };

  test("con el golpe activo, cualquier pregunta lo nombra primero, con el bloqueo y la vuelta por fases", () => {
    for (const q of ["¿entreno fuerte hoy?", "¿cómo va mi carga?", "cómo voy", "me duele la rodilla"]) {
      const reply = coachReply(q, blow, TR_ES, listEs);
      expect(reply, q).toMatch(/^Lo primero es el golpe en la cabeza/);
      expect(reply, q).not.toMatch(GO_HARD);
      for (const r of HEAD_BLOW_RULES) expect(reply, q).toContain(`[[regla:${r.key}]]`);
    }
    // El mareo pide parar e ir al médico ya: va delante del golpe
    expect(coachReply("estoy mareado", blow, TR_ES, listEs)).toMatch(/^Para y no entrenes hoy[^]*Lo primero es el golpe/);
  });

  test("el briefing y las recomendaciones del golpe mandan sobre la carga y la recuperación", () => {
    const b = buildBriefing(blow, TR_ES, listEs);
    expect(b.blocked).toBe(true);
    expect(b.text).toMatch(/contacto bloqueado/);
    expect(b.rules).toEqual(HEAD_BLOW_RULES);
    expect(b.text).not.toMatch(/buen día para una sesión exigente/);
    const recs = buildRecs(blow, TR_ES, listEs);
    expect(recs[0].id).toBe("golpe");
    expect(recs[0].rule).toEqual(COMBAT_RULES.returnSteps);
    expect(recs.map((r) => r.id)).not.toContain("ok");
    // Sin golpe, el briefing no está bloqueado
    expect(buildBriefing(ctx, TR_ES, listEs).blocked).toBe(false);
  });

  test("con una lesión guardada, el dolor nombra el dolor y la lesión", () => {
    const hurt: Ctx = { ...ctx, injuries: ["Rodilla derecha tras sparring"] };
    const reply = coachReply("me duele la rodilla, ¿entreno hoy?", hurt, TR_ES, listEs);
    expect(reply).toMatch(/^Tienes guardada una lesión: Rodilla derecha tras sparring\./);
    expect(reply).toMatch(/Con un dolor nuevo o una lesión/);
    expect(reply).toContain(`[[regla:${SAFETY_RULES.newPain.key}]]`);
  });

  test("con una lesión guardada, el entreno lleva su límite, sin «dale duro» y sin bloquear todo", () => {
    const hurt: Ctx = { ...ctx, injuries: ["hombro"] };
    const reply = coachReply("¿entreno fuerte hoy?", hurt, TR_ES, listEs);
    expect(reply).not.toMatch(/dale duro|tienes margen/);
    expect(reply).toMatch(/Ojo con tu lesión \(hombro\)[^]*el resto, normal/);
    const b = buildBriefing(hurt, TR_ES, listEs);
    expect(b.blocked).toBe(false);
    expect(b.text).toMatch(/Lesión guardada \(hombro\)/);
    expect(b.rules).toContain(SAFETY_RULES.newPain);
    const rec = buildRecs(hurt, TR_ES, listEs).find((r) => r.id === "lesion")!;
    expect(rec.tone).toBe("warn");
    expect(rec.rule).toEqual(SAFETY_RULES.newPain);
  });

  test("las lesiones salen del perfil (motivos del motor) y de la memoria del coach, sin repetir", () => {
    const reasons = [
      { code: "injury_unassessed", params: { area: "rodilla" } },
      { code: "injury_managed", params: { area: "hombro", professional: "fisio" } },
      { code: "parq_review_vigorous", params: {} },
    ];
    expect(injuryAreas(reasons, "Rodilla")).toEqual(["rodilla", "hombro"]);
    expect(injuryAreas(reasons, "codo")).toEqual(["rodilla", "hombro", "codo"]);
    expect(injuryAreas([], null)).toEqual([]);
  });
});
