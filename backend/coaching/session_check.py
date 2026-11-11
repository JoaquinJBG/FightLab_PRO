"""`GET /coach/session-check`: aviso al registrar a mano una sesión vigorosa (spec §8.2).

Con `review_before_vigorous`, `cap_moderate`, `no_training` (o `no_all_out_sprints` para los
sprints), registrar sparring duro, HIIT, sprints, comba, pliometría o un test de 1RM muestra un
aviso con el motivo. No bloquea guardar: la spec pide no bloquear el registro de lo ya hecho.

Qué modalidad de `MODALITY_INTENSITY` es una sesión lo decide el servidor con lo que el usuario
elige al registrarla:

- MMA: el tipo de trabajo y el RPE. El RPE separa lo duro de lo suave con la escala 0-10 del coach
  ("vigorous begins at a level of 7 or 8"); en el combate el corte exacto entre clases es una
  convención de FightLab (combat-sports "Technical drilling runs below sparring") y se etiqueta así.
  Sin RPE, el sparring y el trabajo con contacto cuentan como duros (el lado prudente).
- Deportes: la comba siempre (cardio-health "Jump rope as conditioning"); los formatos `hiit` y
  `sprints` de correr, bici, natación o elíptica.
- Gimnasio: lo que el usuario marca al terminar (test de 1RM, pliometría).

Parámetros: `kind` (`MMA`, `SPORT`, `GYM`), `work_type`, `art`, `sport_key`, `sport_format` (no `format`: DRF lo usa para elegir el renderer), `rpe` e
`includes` (repetible: `one_rm_test`, `plyometrics`).
"""
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import rules, safety_state
from .models import KnowledgeRule
from .safety_views import _lang, _today
from .targets import _key, reasons_data

EFFORT_SCALE = 'cardio-health.md: "0-10 effort scale and talk-test anchors"'
VIGOROUS_RPE = 7  # "vigorous begins at a level of 7 or 8" (EFFORT_SCALE)

GRAPPLING_ARTS = ("BJJ", "Lucha")
SPORT_FORMATS = ("continuous", "hiit", "sprints")
GYM_INCLUDES = ("one_rm_test", "plyometrics")
# Los flags que dan el aviso; `no_contact` ya tiene el suyo en la pantalla de MMA. El golpe en la
# cabeza y la lesión sin valorar también quitan lo vigoroso (R4-10, `safety_state`).
WARN_FLAGS = ("no_training", "review_before_vigorous", "cap_moderate", "no_all_out_sprints", "head_blow_return", "injury_unassessed")
# Motivos que ponen cada flag (`bridge/reasons.py` y `combat.py`).
FLAG_REASONS = {
    **safety_state.FLAG_REASONS,
    "head_blow_return": ("head_blow_red_flags", "head_blow_no_contact"),
    "injury_unassessed": ("injury_unassessed",),
}


def _mma(work_type: str, art: str, rpe: int | None) -> list[str]:
    hard = rpe is None or rpe >= VIGOROUS_RPE
    grappling = art in GRAPPLING_ARTS
    if work_type == "Sparring":
        if grappling:
            return ["rolling_hard" if hard else "rolling_flow"]
        return ["sparring_hard" if hard else "sparring_light"]
    if work_type in ("Pads", "Saco"):
        return ["pads_hard" if hard else "bag_slow"]
    if work_type == "Drilling":
        return ["drills_all_out" if rpe is not None and rpe >= VIGOROUS_RPE else "technical_drilling"]
    if work_type == "Técnica":
        return ["technical_drilling"]
    if work_type == "Acondicionamiento":
        return ["hiit" if rpe is not None and rpe >= VIGOROUS_RPE else "continuous_moderate"]
    return []


def modalities_for(kind: str, *, work_type="", art="", sport_key="", fmt="", rpe=None, includes=()) -> tuple[list[str], bool]:
    """Las modalidades de la sesión y si el RPE ha decidido la clase."""
    if kind == "MMA":
        return _mma(work_type, art, rpe), work_type in ("Sparring", "Pads", "Saco", "Drilling", "Acondicionamiento")
    if kind == "SPORT":
        if sport_key == "rope":
            return ["jump_rope"], False
        if fmt in ("hiit", "sprints"):
            return [fmt], False
        return [], False
    if kind == "GYM":
        return [i for i in GYM_INCLUDES if i in includes], False
    return [], False


def check(user, today, lang: str, **session) -> dict:
    keys, by_rpe = modalities_for(**session)
    state = safety_state.for_user(user, today)
    modalities = []
    warn_flags: list[str] = []
    for key in keys:
        m = rules.MODALITY_INTENSITY[key]
        blocked = [f for f in state.blocked_by(key) if f in WARN_FLAGS]
        if m.intensity in (rules.VIGOROUS, rules.MAXIMAL) and blocked:
            warn_flags += [f for f in blocked if f not in warn_flags]
        modalities.append({
            "key": key,
            "intensity": m.intensity,
            "rule_key": _key(m.rule) if m.rule else None,
            "convention": m.convention,
            "blocked_by": blocked,
        })
    effort_key = _key(EFFORT_SCALE)
    wanted = {m["rule_key"] for m in modalities if m["rule_key"]} | {effort_key}
    grades = dict(KnowledgeRule.objects.filter(key__in=wanted).values_list("key", "grade"))
    for m in modalities:
        m["grade"] = grades.get(m["rule_key"])
    codes = {c for f in warn_flags for c in FLAG_REASONS[f]}
    reasons = []
    for _, r, _, _ in state.reasons():
        if r.code in codes and r not in reasons:
            reasons.append(r)
    combat = session.get("kind") == "MMA"
    return {
        "modalities": modalities,
        "rpe_basis": {
            "threshold": VIGOROUS_RPE,
            "rule_key": effort_key,
            "grade": grades.get(effort_key),
            # El corte entre clases del combate lo pone FightLab (combat-sports, anexo E).
            "convention": "fightlab" if combat else None,
        } if by_rpe and keys else None,
        "warn": bool(warn_flags),
        "flags": warn_flags,
        "reasons": reasons_data(reasons, lang),
        # No bloquea: lo ya hecho se registra siempre (spec §8.2).
        "blocks_saving": False,
    }


def _int(raw):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if 1 <= value <= 10 else None


class SessionCheckView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = request.query_params
        kind = q.get("kind", "")
        if kind not in ("MMA", "SPORT", "GYM"):
            return Response({"kind": ["MMA, SPORT or GYM"]}, status=status.HTTP_400_BAD_REQUEST)
        fmt = q.get("sport_format", "")
        if fmt and fmt not in SPORT_FORMATS:
            return Response({"sport_format": list(SPORT_FORMATS)}, status=status.HTTP_400_BAD_REQUEST)
        includes = [i for i in q.getlist("includes") if i in GYM_INCLUDES]
        return Response(check(
            request.user, _today(request.user.profile), _lang(),
            kind=kind, work_type=q.get("work_type", ""), art=q.get("art", ""),
            sport_key=q.get("sport_key", ""), fmt=fmt, rpe=_int(q.get("rpe")), includes=includes,
        ))
