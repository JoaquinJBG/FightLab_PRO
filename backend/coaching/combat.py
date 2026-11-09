"""Bloqueos propios de los deportes de combate (spec §8.3, E.5), con las reglas del anexo.

El motor del coach no sabe nada de golpes en la cabeza ni de cortes de peso: estos flags los
añade FightLab junto a los del motor en `GET /coach/safety`.

- `no_contact`: un golpe en la cabeza con síntomas (o con señales de alarma) bloquea sparring,
  clinch, drills con compañero y grappling en vivo hasta que el atleta confirma el alta de un
  clínico. La mecánica del flag es una convención de FightLab que la propia regla declara.
- `no_cut_content`: sin contenido de corte de peso para menores de 18 (convención de FightLab
  apoyada en el consenso, que la regla declara).
"""
from dataclasses import dataclass, field
from datetime import date

from .bridge.reasons import Reason
from .keys import rule_key

FILE = "combat-sports.md"
NO_CONTACT_RULE = rule_key(FILE, "A head blow with symptoms sets no-contact and refers")
RED_FLAGS_RULE = rule_key(FILE, "Red flags after a head blow mean emergency care")
CLEARANCE_RULE = rule_key(FILE, "No sparring until symptom-free with exertion and cleared")
# La vuelta al contacto por fases, supervisada por un clínico: la que enseña la tarjeta del golpe.
RETURN_STEPS_RULE = rule_key(FILE, "Return to contact follows a graded clinician-supervised plan")
MINORS_CUT_RULE = rule_key(FILE, "No weight-cut content for minors, and refer repeated cutters")

ADULT_AGE = 18


@dataclass
class CombatFlags:
    no_contact: bool = False
    no_cut_content: bool = False
    reasons: list[Reason] = field(default_factory=list)


def _age(dob: date | None, today: date) -> int | None:
    if dob is None:
        return None
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def combat_flags(profile, today: date) -> CombatFlags:
    out = CombatFlags()
    open_blows = [i for i in profile.head_impacts.all() if i.blocks_contact and i.occurred_on <= today]
    if open_blows:
        out.no_contact = True
        # Las señales de alarma piden urgencias ahora: el aviso se ve el día del golpe; después
        # queda el bloqueo (convención de FightLab, sin revisar).
        if any(i.red_flags and i.occurred_on == today for i in open_blows):
            out.reasons.append(Reason("head_blow_red_flags", RED_FLAGS_RULE))
        out.reasons.append(Reason("head_blow_no_contact", NO_CONTACT_RULE))
    age = _age(profile.date_of_birth, today)
    out.no_cut_content = age is not None and age < ADULT_AGE
    return out
