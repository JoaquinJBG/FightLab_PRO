"""El estado de seguridad de hoy: una sola fuente de verdad (R4-10, R4-13).

Tres pantallas decían «Listo para entrenar» u ofrecían «Intenso» después de un golpe en la cabeza
porque cada una miraba sus propios flags. Aquí se juntan una vez:

- los flags del motor (`services.safety_for`): «para y consulta» (`no_training`), solo moderado
  (`cap_moderate`), revisar antes de lo vigoroso (`review_before_vigorous`), lesiones;
- los de combate (`combat.combat_flags`): el golpe en la cabeza (`no_contact`);
- las lesiones activas de la BD (las del perfil y las del check-in, «dolor nuevo»).

De ahí salen `level` («ok», «caution» o «stop»), si hoy se puede hacer algo vigoroso (con la regla
de `rules.intensity_blocked_by`, la misma del plan) y la lista de lo activo con su motivo, su
vigencia y su regla. Lo leen `GET /coach/safety` (y con él Hoy, Inicio, Coach, Carga y Deportes),
el plan y Mi rutina (`plan.live_safety`), el aviso de sesión vigorosa y el chat con IA.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from coach.profile import ProfileIncomplete
from coach.safety import SafetyFlags

from . import combat, rules
from .bridge import reason_texts
from .bridge.reasons import Reason, parse_reason
from .models import Injury, KnowledgeRule

# Motivos del motor que ponen cada flag de entrenamiento (`bridge/reasons.py`).
FLAG_REASONS = {
    "no_training": ("bp_no_exercise", "bp_no_training", "cardiac_symptoms", "no_training_desk_pal"),
    "review_before_vigorous": ("parq_unanswered_light", "parq_review_vigorous"),
    "cap_moderate": ("bp_unknown_hypertension", "bp_gp_review", "bp_moderate"),
    "no_all_out_sprints": ("parq_no_sprints",),
}
INJURY_CODES = ("injury_unassessed", "injury_managed")

# Hasta cuándo dura cada cosa (la vigencia): no hay fechas inventadas, solo quién la levanta.
UNTIL_CLEARANCE = "clearance"  # el alta de un clínico (golpe en la cabeza)
UNTIL_ASSESSED = "assessed"  # que un médico o fisio valore la lesión
UNTIL_CLEARED = "cleared"  # que quien lleva la lesión la dé por curada
UNTIL_REVIEW = "review"  # la revisión de un médico o de un profesional del ejercicio


@dataclass
class SafetyState:
    flags: SafetyFlags
    fight: combat.CombatFlags
    injuries: list[Injury] = field(default_factory=list)
    # Sin un dato del perfil el motor no evalúa: se queda con los flags vacíos, pero el golpe y las
    # lesiones (que no dependen del perfil) siguen contando.
    engine_ok: bool = True
    profile: object = None
    today: date | None = None

    @property
    def no_contact(self) -> bool:
        return self.fight.no_contact

    @property
    def injured(self) -> bool:
        """Una lesión activa que nadie ha valorado: nada vigoroso hasta que la valoren."""
        return any(not (i.professional or "").strip() for i in self.injuries)

    def blocked_by(self, key: str) -> list[str]:
        """`rules.blocked_by` de una modalidad con todo lo de hoy."""
        return rules.blocked_by(key, self.flags, self.no_contact, self.injured)

    def intensity_blocked_by(self, intensity: str) -> list[str]:
        return rules.intensity_blocked_by(intensity, self.flags, self.no_contact, self.injured)

    @property
    def vigorous_blocked_by(self) -> list[str]:
        return self.intensity_blocked_by(rules.VIGOROUS)

    @property
    def level(self) -> str:
        if self.flags.no_training:
            return "stop"
        if self.vigorous_blocked_by or self.no_contact or self.injuries:
            return "caution"
        return "ok"

    def reasons(self) -> list[tuple[str, Reason, date | None, str]]:
        """Lo activo hoy: `(tipo, motivo, desde, hasta)`, lo más grave primero."""
        out: list[tuple[str, Reason, date | None, str]] = []
        engine = [parse_reason(t) for t in dict.fromkeys(self.flags.reasons)]
        stop = [r for r in engine if r.code in FLAG_REASONS["no_training"]]
        out += [("stop", r, None, UNTIL_REVIEW) for r in stop]
        if self.no_contact:
            since = min((i.occurred_on for i in self._open_blows()), default=None)
            out += [("head_blow", r, since, UNTIL_CLEARANCE) for r in self.fight.reasons]
        by_area = {i.area.strip().lower(): i for i in self.injuries}
        seen = set()
        for r in engine:
            if r.code in INJURY_CODES:
                area = str(r.params.get("area", "")).strip().lower()
                row = by_area.get(area)
                seen.add(area)
                until = UNTIL_CLEARED if r.code == "injury_managed" else UNTIL_ASSESSED
                out.append(("injury", r, row.since if row else None, until))
        for area, row in by_area.items():
            if area in seen:
                continue
            # Sin el motor (perfil incompleto), la lesión sale igual con la regla del coach.
            code = "injury_managed" if (row.professional or "").strip() else "injury_unassessed"
            params = {"area": row.area, **({"professional": row.professional} if code == "injury_managed" else {})}
            out.append(("injury", Reason(code, INJURY_RULE, params), row.since, UNTIL_CLEARED if code == "injury_managed" else UNTIL_ASSESSED))
        for flag in ("cap_moderate", "review_before_vigorous"):
            if getattr(self.flags, flag):
                out += [("limit", r, None, UNTIL_REVIEW) for r in engine if r.code in FLAG_REASONS[flag]]
        return out

    def _open_blows(self):
        if self.profile is None:
            return []
        return [i for i in self.profile.head_impacts.all() if i.blocks_contact and (self.today is None or i.occurred_on <= self.today)]

    def data(self, lang: str) -> dict:
        """Para la API (`GET /coach/safety` → `state`)."""
        items = self.reasons()
        keys = {r.rule_key for _, r, _, _ in items if r.rule_key}
        grades = dict(KnowledgeRule.objects.filter(key__in=keys).values_list("key", "grade"))
        return {
            "level": self.level,
            "no_contact": self.no_contact,
            "no_training": bool(self.flags.no_training),
            "vigorous": {"allowed": not self.vigorous_blocked_by, "blocked_by": self.vigorous_blocked_by},
            "active": [
                {
                    "kind": kind,
                    "code": r.code,
                    "rule_key": r.rule_key,
                    "grade": grades.get(r.rule_key),
                    "params": r.params,
                    "text": reason_texts.describe(r, lang)["text"],
                    "since": since.isoformat() if since else None,
                    "until": until,
                }
                for kind, r, since, until in items
            ],
        }


def _injury_rule() -> str | None:
    from coach import safety

    return parse_reason(f"{safety.INJURY}: x injury not yet assessed").rule_key


INJURY_RULE = _injury_rule()


def of(profile, today: date, flags: SafetyFlags | None = None) -> SafetyState:
    """El estado de hoy de un `UserProfile`. Con `flags` (los del motor ya calculados) no se
    vuelven a pedir."""
    engine_ok = True
    if flags is None:
        from . import services

        try:
            flags = services.safety_for(profile.user, today)
        except (ProfileIncomplete, ValueError):
            flags, engine_ok = SafetyFlags(), False
    state = SafetyState(
        flags=flags,
        fight=combat.combat_flags(profile, today),
        injuries=[i for i in profile.injuries.all() if i.status == Injury.Status.ACTIVE],
        engine_ok=engine_ok,
        profile=profile,
        today=today,
    )
    return state


def for_user(user, today: date) -> SafetyState:
    return of(user.profile, today)
