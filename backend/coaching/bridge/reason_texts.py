"""Plantillas de los motivos del motor en español e inglés (spec §7.5, sugerencia U03).

Se indexan por el `code` de `bridge/reasons.py`. En inglés reproducen el texto original de
`coach/safety.py` (un test lo compara con la salida real del motor); en español son la
traducción de FightLab de ese mismo texto, sin añadir nada. Un motivo sin plantilla
(`code="unknown"` o uno nuevo del motor) se muestra con su texto original.

Cubre los motivos de `coach.safety` (fase 3) y los de energía, macros, zonas y tendencia
(fase 4). Los de menús llegan con su fase. Los motivos de FightLab que añade el puente
(ecuación para atletas, `no_training`) llevan también la regla del coach que los respalda.

La línea de derivación se lee literal de `docs/safety.md` del motor, no se copia aquí.
"""
import re
from pathlib import Path

import coach
from coach import safety

from .reasons import Reason

LANGUAGES = ("es", "en")
DEFAULT_LANGUAGE = "es"

SAFETY_DOC = Path(coach.__file__).resolve().parent.parent / "docs" / "safety.md"

_CUT = safety.SCOFF_CUT_POINT

TEXTS: dict[str, dict[str, str]] = {
    "en": {
        "under_18": (
            "under 18, out of scope: no calorie targets, deficits or weigh-ins; "
            "suggest a paediatrician, GP or paediatric dietitian"
        ),
        "eating_disorder_screen": (
            f"positive screen ({_CUT} or more yes answers) or a warning sign, so no deficit, weight "
            "targets or weigh-ins; suggest a GP or eating-disorder professional"
        ),
        "glp1_prescriber": "the prescriber owns the weight plan, no extra deficit",
        "pregnancy_glp1": "GLP-1 user pregnant or planning pregnancy, contact the prescriber promptly",
        "beta_blocker_rpe": "prescribe by RPE and the talk test",
        "pregnancy_no_deficit": "no deficit; weight targets belong to the midwife or obstetrician",
        "pregnancy_activity": "clear the plan with the obstetric care provider",
        "pregnancy_intensity": "gauge intensity by talk test and RPE",
        "menstrual_irregular": "new irregular periods, stop increasing the deficit",
        "menstrual_absent": (
            "periods absent 3 months or more (or fewer than 6 a year), stop the deficit and refer"
        ),
        "parq_followup": "follow-up YES, pause intensity progression and refer",
        "parq_no_sprints": "{why}, so no all-out sprint formats (SIT, REHIT); they need every answer NO",
        "parq_unanswered_light": "PAR-Q+ not answered, so light-to-moderate work only until it is",
        "parq_review_vigorous": (
            "{why}, so a qualified exercise professional or clinician reviews vigorous or maximal "
            "work (HIIT, 1RM tests, all-out sprints) before it starts; light-to-moderate work "
            "until then"
        ),
        "injury_managed": (
            "{area} injury, managed by {professional}: no progression; reduce or swap the lift "
            "within the limits {professional} set, who decides when it progresses"
        ),
        "injury_unassessed": (
            "{area} injury not yet assessed: a GP or physiotherapist assesses it before it is "
            "loaded; stop and refer for sharp or worsening pain"
        ),
        "bp_unknown_hypertension": (
            "BP unknown with known hypertension, so a GP review before starting or progressing, "
            "and light-to-moderate work only"
        ),
        "bp_no_exercise": (
            "{reading}, no exercise; re-measure after 5-10 min and see a doctor promptly if it "
            "stays high (urgently with headache, chest pain, visual change, neurological symptoms "
            "or breathlessness)"
        ),
        "bp_no_training": "{reading}, no training until reviewed by a GP",
        "bp_gp_review": (
            "{reading}, GP review before starting or progressing; light-to-moderate work only "
            "until BP is controlled"
        ),
        "bp_moderate": "{reading}, moderate intensity and a GP check",
        "cardiac_symptoms": (
            "stop exercising and seek medical evaluation; no training until a clinician clears it"
        ),
        "pregnancy_intensity_rpe": "moderate is RPE 13-14 or talk but not sing; HR is secondary",
        "pregnancy_vigorous": (
            "vigorous only if already vigorously active before pregnancy; never RPE 18 or more"
        ),
        "beta_blocker_no_vigorous": (
            "no sustained vigorous work (RPE 14 or more) without medical clearance; start at the "
            "low end of moderate"
        ),
        "older_no_deficit": (
            "no deficit for adults about {age}+ unless they have obesity with a weight-related "
            "health problem"
        ),
        "recalibrate_start": "starting estimate, recalibrate after 2-4 weeks of weigh-ins",
        "recalibrate_equation": "starting estimate from an equation",
        "recalibrate_from_trend": "maintenance from the weight trend; re-check in 2-4 weeks",
        "recalibrate_step": (
            "one step of {step_kcal} kcal down from the current {current_kcal} kcal; the full "
            "target is {target_kcal_fmt} kcal"
        ),
        "floor_raised": "raised to the {floor_kcal_fmt} kcal floor; going lower needs clinical supervision",
        "glp1_low_intake": (
            "below {kcal_fmt} kcal, favour nutrient-dense foods and discuss supplements and "
            "monitoring with the prescriber"
        ),
        "intake_unknown_holding": "current intake unknown: holding at maintenance",
        "protein_per_kg": "{per_kg_g} g/kg/day",
        "protein_reference_weight": (
            "convention: protein from {weight_kg_0f} kg, the weight at BMI 25 for this height, "
            "instead of body weight"
        ),
        "carbs_zero": "protein and fat minimums already exceed the calorie target; carbs set to 0",
        "pal_too_low": (
            "PAL {pal_g} is too low: never 1.2 for ambulatory adults, use at least 1.4 "
            '(nutrition.md: "Activity multipliers (PAL)")'
        ),
        "pal_too_high": (
            "PAL {pal_g} is too high: not above about 2.0 for recreational gym-goers "
            '(nutrition.md: "Activity multipliers (PAL)")'
        ),
        "bands_approx": "zones are approximate; check them against RPE and the talk test",
        "bands_cardiac_team": "with known heart disease, use the zones the cardiac team sets",
        "hrmax_tanaka": (
            "HRmax from Tanaka is a rough start and can be off by 20+ bpm; use an observed "
            "all-out peak when you have one"
        ),
        "no_weigh_ins": "no weigh-ins",
        "trend_insufficient": "need at least {min_points} weigh-ins covering {min_days} days",
    },
    "es": {
        "under_18": (
            "menor de 18 años, fuera del alcance del coach: sin objetivos de calorías, déficits "
            "ni pesajes; consulta a un pediatra, a tu médico de cabecera o a un dietista-"
            "nutricionista pediátrico"
        ),
        "eating_disorder_screen": (
            f"cribado positivo ({_CUT} o más respuestas afirmativas) o una señal de alarma: sin "
            "déficit, objetivos de peso ni pesajes; consulta a tu médico de cabecera o a un "
            "profesional de trastornos de la conducta alimentaria"
        ),
        "glp1_prescriber": "el plan de peso lo lleva quien te receta el medicamento; sin déficit añadido",
        "pregnancy_glp1": (
            "usas un GLP-1 y estás embarazada o buscas el embarazo: contacta pronto con quien te "
            "lo receta"
        ),
        "beta_blocker_rpe": "la intensidad se pauta por esfuerzo percibido (RPE) y la prueba del habla",
        "pregnancy_no_deficit": "sin déficit; los objetivos de peso corresponden a tu matrona o a tu obstetra",
        "pregnancy_activity": "revisa el plan con tu profesional de atención obstétrica",
        "pregnancy_intensity": "mide la intensidad con la prueba del habla y el esfuerzo percibido (RPE)",
        "menstrual_irregular": "reglas irregulares nuevas: no aumentes el déficit",
        "menstrual_absent": (
            "sin regla desde hace 3 meses o más (o menos de 6 al año): se detiene el déficit y "
            "conviene consultar"
        ),
        "parq_followup": (
            "algún SÍ en las preguntas de seguimiento del PAR-Q+: se pausa la progresión de la "
            "intensidad y conviene consultar"
        ),
        "parq_no_sprints": (
            "{why}: nada de esprints a tope (SIT, REHIT); exigen que todas las respuestas sean NO"
        ),
        "parq_unanswered_light": "PAR-Q+ sin contestar: solo trabajo ligero o moderado hasta que lo contestes",
        "parq_review_vigorous": (
            "{why}: un profesional del ejercicio cualificado o un clínico revisa el trabajo "
            "vigoroso o máximo (HIIT, test de 1RM, esprints a tope) antes de empezarlo; hasta "
            "entonces, trabajo ligero o moderado"
        ),
        "injury_managed": (
            "lesión en {area}, la lleva {professional}: sin progresión; reduce o cambia el "
            "ejercicio dentro de los límites que haya marcado {professional}, que decide cuándo "
            "progresa"
        ),
        "injury_unassessed": (
            "lesión en {area} sin valorar: un médico de cabecera o un fisioterapeuta la valora "
            "antes de cargarla; para y consulta si el dolor es agudo o va a peor"
        ),
        "bp_unknown_hypertension": (
            "tensión desconocida con hipertensión conocida: revisión con tu médico de cabecera "
            "antes de empezar o progresar, y solo trabajo ligero o moderado"
        ),
        "bp_no_exercise": (
            "{reading}: sin ejercicio; vuelve a medirla tras 5-10 min y ve pronto al médico si "
            "sigue alta (con urgencia si hay dolor de cabeza, dolor en el pecho, cambios en la "
            "vista, síntomas neurológicos o falta de aire)"
        ),
        "bp_no_training": "{reading}: sin entrenar hasta que la revise tu médico de cabecera",
        "bp_gp_review": (
            "{reading}: revisión con tu médico de cabecera antes de empezar o progresar; solo "
            "trabajo ligero o moderado hasta que la tensión esté controlada"
        ),
        "bp_moderate": "{reading}: intensidad moderada y revisión con tu médico de cabecera",
        "cardiac_symptoms": (
            "deja de hacer ejercicio y busca valoración médica; sin entrenar hasta que un clínico "
            "te dé el alta"
        ),
        "pregnancy_intensity_rpe": (
            "moderado es un esfuerzo percibido (RPE) de 13-14, o poder hablar pero no cantar; la "
            "frecuencia cardiaca es secundaria"
        ),
        "pregnancy_vigorous": (
            "esfuerzo vigoroso solo si ya eras vigorosamente activa antes del embarazo; nunca un "
            "RPE de 18 o más"
        ),
        "beta_blocker_no_vigorous": (
            "nada de trabajo vigoroso sostenido (RPE 14 o más) sin permiso médico; empieza por la "
            "parte baja de lo moderado"
        ),
        "older_no_deficit": (
            "sin déficit a partir de unos {age} años, salvo obesidad con algún problema de salud "
            "relacionado con el peso"
        ),
        "recalibrate_start": (
            "estimación de partida: recalibra tras 2-4 semanas de pesajes"
        ),
        "recalibrate_equation": "estimación de partida a partir de una ecuación",
        "recalibrate_from_trend": (
            "mantenimiento calculado con la tendencia de peso; vuelve a comprobarlo en 2-4 semanas"
        ),
        "recalibrate_step": (
            "un paso de {step_kcal} kcal hacia abajo desde las {current_kcal} kcal actuales; el "
            "objetivo completo es de {target_kcal} kcal"
        ),
        "floor_raised": (
            "subido al suelo de {floor_kcal} kcal; bajar más exige supervisión clínica"
        ),
        "glp1_low_intake": (
            "por debajo de {kcal} kcal, prioriza alimentos con mucha densidad de nutrientes y "
            "habla con quien te receta el medicamento sobre suplementos y seguimiento"
        ),
        "intake_unknown_holding": "ingesta actual desconocida: se mantiene en el mantenimiento",
        "protein_per_kg": "{per_kg_g} g/kg/día",
        "protein_reference_weight": (
            "convención: la proteína se calcula sobre {weight_kg_0f} kg, el peso con IMC 25 para "
            "tu altura, en lugar del peso corporal"
        ),
        "carbs_zero": (
            "el mínimo de proteína y de grasa ya supera el objetivo de calorías; carbohidratos a 0"
        ),
        "pal_too_low": (
            "un PAL de {pal_g} es demasiado bajo: nunca 1,2 para adultos que caminan, usa al menos "
            '1,4 (nutrition.md: "Activity multipliers (PAL)")'
        ),
        "pal_too_high": (
            "un PAL de {pal_g} es demasiado alto: no más de 2,0 para quien entrena en el gimnasio "
            'por afición (nutrition.md: "Activity multipliers (PAL)")'
        ),
        "bands_approx": (
            "las zonas son aproximadas; compruébalas con el esfuerzo percibido (RPE) y la prueba del habla"
        ),
        "bands_cardiac_team": (
            "con cardiopatía conocida, usa las zonas que marque tu equipo de cardiología"
        ),
        "hrmax_tanaka": (
            "la frecuencia máxima de Tanaka es una estimación de partida y puede fallar en más de "
            "20 lpm; usa un pico real medido a tope cuando lo tengas"
        ),
        "no_weigh_ins": "sin pesajes",
        "trend_insufficient": "hacen falta al menos {min_points} pesajes repartidos en {min_days} días",
    },
}

# `why` de las reglas del PAR-Q+ (`params["why"]` de `reasons.py`).
WHY: dict[str, dict[str, str]] = {
    "en": {"yes": "a PAR-Q+ YES", "unanswered": "PAR-Q+ not answered", "age": "aged {age} or more"},
    "es": {"yes": "algún SÍ en el PAR-Q+", "unanswered": "PAR-Q+ sin contestar", "age": "{age} años o más"},
}

# El profesional que nombra cada motivo ("else the GP", docs/safety.md). None: el motivo no
# deriva a nadie. `injury_managed` usa el que escribió el usuario.
GP = {"en": "GP", "es": "médico de cabecera"}
PROFESSIONAL: dict[str, dict[str, str] | None] = {
    "under_18": {"en": "paediatrician, GP or paediatric dietitian",
                 "es": "pediatra, médico de cabecera o dietista-nutricionista pediátrico"},
    "eating_disorder_screen": {"en": "GP or eating-disorder professional",
                               "es": "médico de cabecera o profesional de trastornos de la conducta alimentaria"},
    "glp1_prescriber": {"en": "prescriber", "es": "quien te receta el medicamento"},
    "pregnancy_glp1": {"en": "prescriber", "es": "quien te receta el medicamento"},
    "beta_blocker_rpe": None,
    "pregnancy_no_deficit": {"en": "midwife or obstetrician", "es": "matrona u obstetra"},
    "pregnancy_activity": {"en": "obstetric care provider", "es": "profesional de atención obstétrica"},
    "pregnancy_intensity": {"en": "obstetric care provider", "es": "profesional de atención obstétrica"},
    "menstrual_irregular": GP,
    "menstrual_absent": GP,
    "parq_followup": GP,
    "parq_no_sprints": None,
    "parq_unanswered_light": None,
    "parq_review_vigorous": {"en": "qualified exercise professional or clinician",
                             "es": "profesional del ejercicio cualificado o clínico"},
    "injury_managed": None,  # el de params["professional"]
    "injury_unassessed": {"en": "GP or physiotherapist", "es": "médico de cabecera o fisioterapeuta"},
    "bp_unknown_hypertension": GP,
    "bp_no_exercise": {"en": "doctor", "es": "médico"},
    "bp_no_training": GP,
    "bp_gp_review": GP,
    "bp_moderate": GP,
    "cardiac_symptoms": {"en": "clinician", "es": "clínico"},
    # Energía, macros, zonas y tendencia: informan o limitan, solo derivan quien receta o el equipo
    # de cardiología.
    "glp1_low_intake": {"en": "prescriber", "es": "quien te receta el medicamento"},
    "bands_cardiac_team": {"en": "cardiac team", "es": "equipo de cardiología"},
}

# Gravedad, según los flags que pone cada motivo en `coach/safety.py`: `stop` si pone
# `no_training`, `refer` si pone `refer_gp`, `limit` si solo limita lo que calcula el motor.
# La agrupación en tres niveles es una convención de FightLab, sin revisar.
SEVERITY: dict[str, str] = {
    "under_18": "refer",
    "eating_disorder_screen": "refer",
    "glp1_prescriber": "limit",
    "pregnancy_glp1": "refer",
    "beta_blocker_rpe": "limit",
    "pregnancy_no_deficit": "refer",
    "pregnancy_activity": "refer",
    "pregnancy_intensity": "refer",
    "menstrual_irregular": "refer",
    "menstrual_absent": "refer",
    "parq_followup": "refer",
    "parq_no_sprints": "limit",
    "parq_unanswered_light": "limit",
    "parq_review_vigorous": "limit",
    "injury_managed": "limit",
    "injury_unassessed": "refer",
    "bp_unknown_hypertension": "refer",
    "bp_no_exercise": "stop",
    "bp_no_training": "stop",
    "bp_gp_review": "refer",
    "bp_moderate": "refer",
    "cardiac_symptoms": "stop",
    # Motivos de energía, macros, zonas y tendencia (fase 4). `info`: explica de dónde sale un
    # número sin limitar nada. `limit`: ha limitado lo que calcula el motor.
    "pregnancy_intensity_rpe": "limit",
    "pregnancy_vigorous": "limit",
    "beta_blocker_no_vigorous": "limit",
    "older_no_deficit": "limit",
    "recalibrate_start": "info",
    "recalibrate_equation": "info",
    "recalibrate_from_trend": "info",
    "recalibrate_step": "info",
    "floor_raised": "limit",
    "glp1_low_intake": "limit",
    "intake_unknown_holding": "info",
    "protein_per_kg": "info",
    "protein_reference_weight": "info",
    "carbs_zero": "limit",
    "pal_too_low": "limit",
    "pal_too_high": "limit",
    "bands_approx": "info",
    "bands_cardiac_team": "limit",
    "hrmax_tanaka": "info",
    "no_weigh_ins": "info",
    "trend_insufficient": "info",
}
DEFAULT_SEVERITY = "limit"


def _lang(lang: str | None) -> str:
    code = (lang or DEFAULT_LANGUAGE).split("-")[0]
    return code if code in LANGUAGES else DEFAULT_LANGUAGE


def _original_body(reason: Reason) -> str:
    text = reason.original_text
    return text.split('": ', 1)[1] if '": ' in text else text


def _decimal(value: float, lang: str) -> str:
    """`1.6` → `1.6` (en) o `1,6` (es), como `:g` (sin ceros de más)."""
    text = f"{value:g}"
    return text.replace(".", ",") if lang == "es" else text


def _values(reason: Reason, lang: str) -> dict:
    params = dict(reason.params)
    # Formatos que reproducen los del motor en inglés (`1,200 kcal`, `2 g/kg/day`) y los de
    # una persona que escribe en español: sin separador de miles en las kcal y con coma decimal.
    for name in [n for n in params if n == "kcal" or n.endswith("_kcal")]:
        params[f"{name}_fmt"] = f"{params[name]:,}" if lang == "en" else str(params[name])
    if "per_kg" in params:
        params["per_kg_g"] = _decimal(params["per_kg"], lang)
    if "pal" in params:
        params["pal_g"] = _decimal(params["pal"], lang)
    if "weight_kg" in params:
        params["weight_kg_0f"] = f"{params['weight_kg']:.0f}"
    if "why" in params:
        params["why"] = WHY[lang][params["why"]].format(**params)
    if "systolic" in params or "diastolic" in params:
        s, d = params.get("systolic"), params.get("diastolic")
        params["reading"] = f"{s if s is not None else '?'}/{d if d is not None else '?'}"
    return params


def render(reason: Reason, lang: str | None) -> str:
    """El texto del motivo en `lang` (español si no es uno de los dos idiomas)."""
    lang = _lang(lang)
    template = TEXTS[lang].get(reason.code)
    if template is None:
        return _original_body(reason)
    return template.format(**_values(reason, lang))


def describe(reason: Reason, lang: str | None) -> dict:
    """Texto, profesional y gravedad de un motivo, para la API."""
    lang = _lang(lang)
    named = PROFESSIONAL.get(reason.code)
    professional = reason.params.get("professional") if reason.code == "injury_managed" else (
        named[lang] if named else None
    )
    return {
        "text": render(reason, lang),
        "professional": professional,
        "severity": SEVERITY.get(reason.code, DEFAULT_SEVERITY),
    }


_DEFERRAL_RE = re.compile(r"^- \*\*(?P<lang>es|en):\*\* `(?P<line>[^`]+)`$", re.M)


def _deferral_lines() -> dict[str, str]:
    """La línea de derivación de `docs/safety.md`, copiada literal en es y en."""
    text = SAFETY_DOC.read_text(encoding="utf-8")
    section = text.split("## The deferral line", 1)[1].split("\n## ", 1)[0]
    lines = {m["lang"]: m["line"] for m in _DEFERRAL_RE.finditer(section)}
    missing = set(LANGUAGES) - set(lines)
    if missing:
        raise RuntimeError(f"docs/safety.md sin línea de derivación en: {', '.join(sorted(missing))}")
    return lines


DEFERRAL_LINE = _deferral_lines()
# El aviso "no sustituye a un profesional" para los textos de seguridad sin `refer_gp`: la
# primera frase de la línea de derivación del coach.
DISCLAIMER = {lang: line.split(". ", 1)[0] + "." for lang, line in DEFERRAL_LINE.items()}
