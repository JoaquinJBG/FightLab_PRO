"""La seguridad del coach al empezar una rutina (F17 R).

No se cambian las reglas: se leen los flags del coach (`coach.safety.flags`) y los de combate
(`coaching.combat.combat_flags`) y se devuelven con la rutina, para que la pantalla de registro
(H) avise antes de empezar:

- `blocked`: `no_training` (p. ej. tensión en reposo demasiado alta hasta que la revise un
  médico). La spec pide no bloquear el registro de lo ya hecho, así que es un aviso, no un 403.
- `reasons`: los motivos que limitan el entrenamiento hoy (`no_training`, `cap_moderate`,
  `review_before_vigorous`, golpe en la cabeza).
- `paused`: los ejercicios de la rutina en pausa por una lesión (`coach.strength.find_pause`),
  con su motivo.

Sin perfil completo o sin cribado no hay flags que leer: no se avisa de nada (y el plan por
reglas tampoco se genera).
"""
from coach import safety as coach_safety
from coach import strength as coach_strength
from coach.profile import ProfileIncomplete

from coaching.bridge.adapters import to_coach_profile
from coaching.bridge.muscle_map import muscle_map
from coaching.bridge.reasons import parse_reason
from coaching.combat import combat_flags
from coaching.safety_views import _lang, _today
from coaching.session_check import FLAG_REASONS
from coaching.targets import reasons_data

TRAINING_REASON_CODES = {
    code for flag in ("no_training", "cap_moderate", "review_before_vigorous") for code in FLAG_REASONS[flag]
}


def start_safety(user, exercises) -> dict:
    """`exercises`: objetos con `exercise_key` y `name`."""
    lang = _lang()
    today = _today(user.profile)
    try:
        flags = coach_safety.flags(to_coach_profile(user, today), today)
    except ProfileIncomplete:
        flags = None
    reasons = []
    if flags is not None:
        reasons = [r for r in (parse_reason(t) for t in dict.fromkeys(flags.reasons)) if r.code in TRAINING_REASON_CODES]
    reasons += combat_flags(user.profile, today).reasons
    paused = []
    if flags is not None and flags.paused_exercises:
        mapped = muscle_map()
        for ex in exercises:
            pause = coach_strength.find_pause(ex.name, flags.paused_exercises, mapped)
            if pause:
                paused.append({
                    "exercise_key": ex.exercise_key,
                    "name": ex.name,
                    "assessed": pause.assessed,
                    "reasons": reasons_data([parse_reason(t) for t in dict.fromkeys(pause.reasons)], lang),
                })
    return {
        "blocked": bool(flags and flags.no_training),
        "reasons": reasons_data(reasons, lang),
        "paused": paused,
    }
