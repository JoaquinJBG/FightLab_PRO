"""Señales de alarma del check-in, estructuradas (Task 5.2, spec §8.2).

En el coach eran el paso 3 de `.claude/skills/checkin/SKILL.md` (texto que el modelo seguía en
la conversación). Aquí son respuestas de sí/no con un código; el efecto va a `Screening` o a
`Injury`, con su `ScreeningEvent` de origen `checkin`, y de ahí lo recogen los flags del motor
(`/coach/safety`). Lo que no tiene campo en el motor (fiebre, rabdomiólisis) se anota como
código en `DailyCheckin.red_flags` y se muestra como aviso con su regla.

La tabla "Red flags" de `docs/safety.md` marca cuáles se aplican en código (`cardiac_symptoms`,
`scoff_positive`) y cuáles son texto de skill respaldado por una regla: aquí los segundos son
avisos con la regla citada, sin efecto sobre los cálculos.

Los textos son los de la skill, en español e inglés. Los niveles son:
`emergency` (llamar ya al número de emergencias), `urgent` (urgencias el mismo día, ahora),
`stop` (parar y ver a un médico), `refer` (derivar), `rest` (no entrenar hoy), `info`.
"""
from datetime import date

from django.core.exceptions import ValidationError

from .bridge.reason_texts import DEFAULT_LANGUAGE, LANGUAGES
from .keys import rule_key
from .models import Injury, KnowledgeRule
from .services import injury_add, screening_set

RECOVERY = "recovery-habits.md"
CARDIAC = rule_key(RECOVERY, "Cardiac warning symptoms: stop and refer")
FEVER = rule_key(RECOVERY, "Fever and systemic illness: do not train")
HEAD_COLD = rule_key(RECOVERY, "Head cold: optional light training")
DISORDERED = rule_key(RECOVERY, "Warning signs that warrant referral")
URGENT = rule_key(RECOVERY, "Urgent medical red flags")
RHABDO = rule_key(RECOVERY, "Recognise it and send to urgent care")
INJURY = rule_key(RECOVERY, "Some pain during exercise is acceptable in chronic, assessed pain")

# code de la alerta -> (nivel, regla que la respalda)
LEVELS: dict[str, tuple[str, str]] = {
    "cardiac_emergency": ("emergency", CARDIAC),
    "cardiac_stop": ("stop", CARDIAC),
    "systemic_illness": ("rest", FEVER),
    "head_cold": ("info", HEAD_COLD),
    "head_cold_no_training": ("rest", HEAD_COLD),
    "disordered_eating": ("refer", DISORDERED),
    "disordered_eating_urgent": ("urgent", URGENT),
    "rhabdo": ("urgent", RHABDO),
    "injury_new": ("refer", INJURY),
    "injury_new_managed": ("info", INJURY),
    "injury_severe": ("stop", INJURY),
}
URGENT_LEVELS = ("emergency", "urgent")  # las pantallas de "urgencia ahora"

# `{number}`: el número de emergencias del usuario, el de su región o, si no hay, el local.
NUMBER_FALLBACK = {"es": "tu número de emergencias local (112 en Europa)", "en": "your local emergency number (112 in Europe)"}

TEXTS: dict[str, dict[str, str]] = {
    "en": {
        "cardiac_emergency": (
            "Call {number} now. Chest pain at rest, fainting, or chest pain with breathlessness and "
            "sweating need emergency care before anything else. Do not exercise."
        ),
        "cardiac_stop": (
            "Stop exercising and see a doctor. Chest, neck, jaw or arm pain or pressure, breathlessness, "
            "dizziness, fainting and palpitations are warning signs. The app will not suggest training "
            "until a clinician clears it."
        ),
        "systemic_illness": "Fever, aches all over or feeling unwell below the neck: no training until you are better.",
        "head_cold": "With a head cold only, light training is optional.",
        "head_cold_no_training": "You have a head cold and the app is not suggesting any training right now: do not train.",
        "disordered_eating": (
            "These can be warning signs of disordered eating. Talk to a GP or an eating-disorder service. "
            "Weigh-ins, weight and calorie targets are switched off in the app."
        ),
        "disordered_eating_urgent": (
            "Fainting, confusion, eating almost nothing for 2 days or more, or vomiting several times a day "
            "need urgent medical care today."
        ),
        "rhabdo": (
            "Very sore, weak or swollen muscles with dark urine after training: go to urgent care now."
        ),
        "injury_new": (
            "Injury recorded. A GP or physiotherapist should assess it before it is loaded; until then the "
            "lifts it affects get no load."
        ),
        "injury_new_managed": (
            "Injury recorded. No progression on the lifts it affects; whoever manages it decides when it "
            "moves."
        ),
        "injury_severe": "Sharp or worsening pain, numbness or weakness: stop and see a doctor.",
    },
    "es": {
        "cardiac_emergency": (
            "Llama ya a {number}. El dolor en el pecho en reposo, el desmayo o el dolor en el pecho con "
            "falta de aire y sudor necesitan atención de urgencia antes que nada. No hagas ejercicio."
        ),
        "cardiac_stop": (
            "Deja de hacer ejercicio y ve a un médico. El dolor u opresión en el pecho, el cuello, la mandíbula "
            "o el brazo, la falta de aire, el mareo, el desmayo y las palpitaciones son señales de aviso. La app "
            "no te sugerirá entrenar hasta que un clínico lo autorice."
        ),
        "systemic_illness": (
            "Fiebre, dolores por todo el cuerpo o malestar por debajo del cuello: no entrenes hasta que estés mejor."
        ),
        "head_cold": "Con solo un resfriado de cabeza, entrenar suave es opcional.",
        "head_cold_no_training": (
            "Tienes un resfriado de cabeza y la app no te sugiere entrenar ahora mismo: no entrenes."
        ),
        "disordered_eating": (
            "Pueden ser señales de un trastorno de la conducta alimentaria. Habla con tu médico o con un servicio "
            "especializado. En la app se desactivan los pesajes y los objetivos de peso y de calorías."
        ),
        "disordered_eating_urgent": (
            "El desmayo, la confusión, comer casi nada durante 2 días o más o vomitar varias veces al día "
            "necesitan atención médica urgente hoy."
        ),
        "rhabdo": (
            "Músculos muy doloridos, débiles o hinchados con orina oscura después de entrenar: ve a urgencias ahora."
        ),
        "injury_new": (
            "Lesión registrada. Un médico o un fisioterapeuta debería valorarla antes de cargarla; hasta entonces, "
            "los ejercicios que afecta no llevan carga."
        ),
        "injury_new_managed": (
            "Lesión registrada. Sin progresión en los ejercicios que afecta; quien la trata decide cuándo avanzan."
        ),
        "injury_severe": "Dolor agudo o que empeora, entumecimiento o debilidad: para y ve a un médico.",
    },
}

PROFESSIONAL: dict[str, dict[str, str]] = {
    "cardiac_stop": {"en": "clinician", "es": "clínico"},
    "disordered_eating": {
        "en": "GP or eating-disorder service",
        "es": "médico de cabecera o servicio de trastornos de la conducta alimentaria",
    },
    "injury_new": {"en": "GP or physiotherapist", "es": "médico de cabecera o fisioterapeuta"},
    "injury_severe": {"en": "doctor", "es": "médico"},
}

SIGN_FIELDS: dict[str, set[str]] = {
    "cardiac": {"emergency"},
    "systemic_illness": set(),
    "head_cold": set(),
    "disordered_eating": {"urgent"},
    "rhabdo": set(),
    "injury": {"area", "since", "professional", "exercises", "severe"},
}


def validate_signs(signs) -> list[dict]:
    """Normaliza la lista de señales o lanza `ValidationError({"signs": …})`. No escribe nada."""

    def fail(message: str):
        raise ValidationError({"signs": message})

    if not isinstance(signs, list):
        fail("expected a list of signs")
    out = []
    for sign in signs:
        if not isinstance(sign, dict) or "code" not in sign:
            fail("each sign needs a code")
        code = sign["code"]
        if code not in SIGN_FIELDS:
            fail(f"unknown sign: {code}")
        extra = sorted(set(sign) - SIGN_FIELDS[code] - {"code"})
        if extra:
            fail(f"{code}: unknown fields: {', '.join(extra)}")
        clean = {"code": code}
        for flag in ("emergency", "urgent", "severe"):
            if flag in sign:
                if not isinstance(sign[flag], bool):
                    fail(f"{code}.{flag} must be true or false")
                clean[flag] = sign[flag]
        if code == "injury":
            area = sign.get("area")
            if not isinstance(area, str) or not area.strip():
                fail("injury: each injury needs an area")
            clean["area"] = area.strip()
            if sign.get("since") is not None:
                try:
                    clean["since"] = date.fromisoformat(str(sign["since"]))
                except ValueError:
                    fail("injury.since must be YYYY-MM-DD")
            professional = sign.get("professional")
            if professional is not None:
                if not isinstance(professional, str):
                    fail("injury.professional must be text")
                clean["professional"] = professional.strip() or None
            exercises = sign.get("exercises", [])
            if not isinstance(exercises, list) or not all(isinstance(e, str) and e.strip() for e in exercises):
                fail("injury.exercises must be exercise names")
            clean["exercises"] = [e.strip() for e in exercises]
        out.append(clean)
    return out


def _alert_code(sign: dict, *, no_training: bool) -> str:
    code = sign["code"]
    if code == "cardiac":
        return "cardiac_emergency" if sign.get("emergency") else "cardiac_stop"
    if code == "disordered_eating":
        return "disordered_eating_urgent" if sign.get("urgent") else "disordered_eating"
    if code == "head_cold":
        return "head_cold_no_training" if no_training else "head_cold"
    return code


def _apply_injury(profile, sign: dict, today: date) -> str:
    area = sign["area"]
    active = [i for i in profile.injuries.filter(status=Injury.Status.ACTIVE)]
    if not any(i.area.strip().casefold() == area.casefold() for i in active):
        injury_add(
            profile,
            area=area,
            since=sign.get("since") or today,
            professional=sign.get("professional") or None,
            exercises=sign["exercises"],
            origin=Injury.Origin.CHECKIN,
        )
    if sign.get("severe"):
        return "injury_severe"
    return "injury_new_managed" if sign.get("professional") else "injury_new"


def apply_signs(user, signs: list[dict], today: date, *, no_training: bool) -> tuple[list[dict], dict]:
    """Escribe el efecto de cada señal y devuelve `(alertas, marcas del día)`.

    `no_training`: el motor ya lo tenía activado (cambia el texto del resfriado). Las marcas son
    `{"illness": …, "red_flags": [códigos]}` para `DailyCheckin`.
    """
    profile = user.profile
    alerts, marks = [], {"illness": None, "red_flags": []}
    for sign in signs:
        code = sign["code"]
        marks["red_flags"].append(code)
        if code == "cardiac":
            screening_set(profile, "cardiac_symptoms", True, origin="checkin", actor=user)
        elif code == "disordered_eating":
            screening_set(profile, "scoff_positive", True, origin="checkin", actor=user)
        elif code == "systemic_illness":
            marks["illness"] = "systemic"
        elif code == "head_cold":
            marks["illness"] = marks["illness"] or "head_cold"
        alert = _apply_injury(profile, sign, today) if code == "injury" else _alert_code(sign, no_training=no_training)
        alerts.append({"code": alert, "sign": code})
    return alerts, marks


def alert_data(alert: dict, lang: str, emergency_number: str | None, grades: dict) -> dict:
    lang = lang if lang in LANGUAGES else DEFAULT_LANGUAGE
    code = alert["code"]
    level, key = LEVELS[code]
    number = emergency_number or NUMBER_FALLBACK[lang]
    named = PROFESSIONAL.get(code)
    return {
        "code": code,
        "sign": alert["sign"],
        "level": level,
        "urgent": level in URGENT_LEVELS,
        "rule_key": key,
        "grade": grades.get(key),
        "text": TEXTS[lang][code].format(number=number),
        "professional": named[lang] if named else None,
    }


def grades_for(codes) -> dict:
    keys = {LEVELS[c][1] for c in codes}
    return dict(KnowledgeRule.objects.filter(key__in=keys).values_list("key", "grade"))
