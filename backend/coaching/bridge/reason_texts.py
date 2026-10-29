"""Plantillas de los motivos del motor en español e inglés (spec §7.5, sugerencia U03).

Se indexan por el `code` de `bridge/reasons.py`. En inglés reproducen el texto original de
`coach/safety.py` (un test lo compara con la salida real del motor); en español son la
traducción de FightLab de ese mismo texto, sin añadir nada. Un motivo sin plantilla
(`code="unknown"` o uno nuevo del motor) se muestra con su texto original.

De momento cubre los motivos de `coach.safety` (fase 3). Los de energía, zonas y menús
llegan con sus fases.

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
}
DEFAULT_SEVERITY = "limit"


def _lang(lang: str | None) -> str:
    code = (lang or DEFAULT_LANGUAGE).split("-")[0]
    return code if code in LANGUAGES else DEFAULT_LANGUAGE


def _original_body(reason: Reason) -> str:
    text = reason.original_text
    return text.split('": ', 1)[1] if '": ' in text else text


def _values(reason: Reason, lang: str) -> dict:
    params = dict(reason.params)
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
