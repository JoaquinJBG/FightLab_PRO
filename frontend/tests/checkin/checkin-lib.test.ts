import { describe, expect, it } from "vitest";
import { EMPTY_FORM, buildPayload, buildSigns, missingWeighIns, parseNum, recordedItems } from "@/lib/checkin";

const NO_WEEKLY = { menstrual: false, bp: false };
const form = (over: Partial<typeof EMPTY_FORM>) => ({ ...EMPTY_FORM, ...over });

describe("lib/checkin", () => {
  it("lee números con coma decimal y descarta lo que no es un número", () => {
    expect(parseNum("71,4")).toBe(71.4);
    expect(parseNum(" 70.25 ")).toBe(70.25);
    expect(parseNum("")).toBeNull();
    expect(parseNum("abc")).toBeNull();
  });

  it("un formulario vacío no manda nada", () => {
    expect(buildPayload(EMPTY_FORM, { blocked: false, weekly: NO_WEEKLY })).toEqual({});
  });

  it("con el pesaje bloqueado no manda peso, cintura ni kcal aunque estén escritos", () => {
    const f = form({ weight: "70", waist: "80", intake: "2000", sleepHours: "7" });
    expect(buildPayload(f, { blocked: true, weekly: NO_WEEKLY })).toEqual({ sleep_hours: 7 });
    expect(buildPayload(f, { blocked: false, weekly: NO_WEEKLY })).toEqual({
      weight_kg: 70, waist_cm: 80, intake_kcal: 2000, sleep_hours: 7,
    });
  });

  it("las preguntas semanales solo viajan si el servidor las pidió", () => {
    const f = form({ period: "absent", contraception: true, bpSystolic: "130", bpDiastolic: "85" });
    expect(buildPayload(f, { blocked: false, weekly: NO_WEEKLY })).toEqual({});
    expect(buildPayload(f, { blocked: false, weekly: { menstrual: true, bp: true } })).toEqual({
      period_status: "absent", hormonal_contraception: true, bp_systolic: 130, bp_diastolic: 85,
    });
  });

  it("las señales son códigos con sus indicadores, no texto", () => {
    const f = form({
      signs: { ...EMPTY_FORM.signs, cardiac: true, disordered_eating: true, rhabdo: true },
      cardiacEmergency: true,
      disorderedUrgent: false,
    });
    expect(buildSigns(f)).toEqual([
      { code: "cardiac", emergency: true },
      { code: "disordered_eating", urgent: false },
      { code: "rhabdo" },
    ]);
  });

  it("una lesión lleva zona, ejercicios limpios y, si hay, profesional", () => {
    const f = form({
      signs: { ...EMPTY_FORM.signs, injury: true },
      injury: { area: " rodilla ", exercises: "Sentadilla, , Zancadas ", professional: " fisio ", severe: false },
    });
    expect(buildSigns(f)).toEqual([
      { code: "injury", area: "rodilla", exercises: ["Sentadilla", "Zancadas"], severe: false, professional: "fisio" },
    ]);
  });

  it("el resumen de lo registrado sale de lo que se mandó", () => {
    const payload = buildPayload(
      form({ weight: "70", sleepHours: "7", scores: { energy: 3 }, notes: "ok", signs: { ...EMPTY_FORM.signs, rhabdo: true } }),
      { blocked: false, weekly: NO_WEEKLY },
    );
    expect(recordedItems(payload)).toEqual(["weight", "sleep", "wellness", "notes", "signs"]);
  });

  it("pesajes que faltan para la tendencia", () => {
    expect(missingWeighIns(4, 7)).toBe(3);
    expect(missingWeighIns(9, 7)).toBe(0);
  });
});
