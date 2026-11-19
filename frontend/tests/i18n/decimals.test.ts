import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import { buildRecs, coachReply, type CoachTr, type Ctx, type Tr } from "@/lib/coach-rules";

// F12 / R3-10 de la prueba en móvil: el coach y el chat decían «80.1 kg» con la app en español.

function trIn(locale: "es" | "en"): CoachTr {
  const messages = locale === "es" ? es : en;
  const tr = (ns: "coach" | "load" | "combat") => createTranslator({ locale, messages, namespace: ns }) as unknown as Tr;
  return { t: tr("coach"), tl: tr("load"), tc: tr("combat"), locale };
}

const ctx: Ctx = {
  metrics: null, recovery: null, weight: 80.1, lastWeightDays: 0, weighTarget: 77.5, weighDays: 5,
  cutAllowed: true, minor: false,
};

describe("decimales del coach con el formato del idioma", () => {
  it("en español, coma decimal en el chat y en las recomendaciones", () => {
    const tr = trIn("es");
    const reply = coachReply("¿cómo va mi peso?", ctx, tr, new Intl.ListFormat("es"));
    expect(reply).toContain("2,6");
    const noTarget = coachReply("¿cómo va mi peso?", { ...ctx, weighTarget: null, weighDays: null }, tr, new Intl.ListFormat("es"));
    expect(noTarget).toContain("80,1");
    expect(noTarget).not.toMatch(/\b80\.1\b/);
    const recs = buildRecs(ctx, tr).map((r) => r.title).join(" ");
    expect(recs).toContain("2,6"); // 80,1 − 77,5
    expect(coachReply("cómo voy", ctx, tr, new Intl.ListFormat("es"))).toContain("77,5");
  });

  it("en inglés, punto decimal", () => {
    const reply = coachReply("how's my weight?", { ...ctx, weighTarget: null, weighDays: null }, trIn("en"), new Intl.ListFormat("en"));
    expect(reply).toContain("80.1");
  });
});
