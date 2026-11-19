"""`coaching/rules.py` (Task 6.3): cada modalidad con su regla o etiquetada como convención."""
import re
from pathlib import Path

import pytest
from coach.safety import SafetyFlags

from coaching import rules

BACKEND = Path(__file__).resolve().parents[2]
KNOWLEDGE = {
    "combat-sports.md": BACKEND / "knowledge_fightlab" / "combat-sports.md",
}
COACH_KNOWLEDGE = BACKEND / "vendor" / "ai-personal-coach" / "knowledge"

VIGOROUS_WORK = ("sparring_hard", "competition", "hiit", "sprints", "jump_rope", "plyometrics", "one_rm_test")


def _headings(file: str) -> set[str]:
    path = KNOWLEDGE.get(file, COACH_KNOWLEDGE / file)
    return set(re.findall(r"^### (.+)$", path.read_text(encoding="utf-8"), re.M))


@pytest.mark.parametrize("key", sorted(rules.MODALITY_INTENSITY))
def test_every_modality_has_a_rule_or_a_convention_label(key):
    m = rules.MODALITY_INTENSITY[key]
    assert m.intensity in rules.INTENSITIES
    assert m.rule or m.convention in ("coach", "fightlab")
    assert m.convention in (None, "coach", "fightlab")


@pytest.mark.parametrize("literal", sorted(rules.rule_literals()))
def test_every_rule_exists_in_the_knowledge(literal):
    file, heading = re.fullmatch(r'([\w-]+\.md): "(.+)"', literal).groups()
    assert heading in _headings(file), literal


def test_sparring_uses_the_combat_annex_rule():
    assert rules.MODALITY_INTENSITY["sparring_hard"].rule == rules.HARD_SPARRING
    assert rules.MODALITY_INTENSITY["sparring_hard"].intensity == rules.VIGOROUS
    assert rules.MODALITY_INTENSITY["sparring_hard"].convention is None
    assert "Hard striking sparring is vigorous in small samples" in _headings("combat-sports.md")


def test_vigorous_work_is_vigorous_or_maximal():
    for key in VIGOROUS_WORK:
        assert rules.MODALITY_INTENSITY[key].intensity in (rules.VIGOROUS, rules.MAXIMAL), key


@pytest.mark.parametrize("flag", ["review_before_vigorous", "cap_moderate"])
def test_vigorous_work_is_out_while_a_review_is_pending(flag):
    flags = SafetyFlags(**{flag: True})
    for key in VIGOROUS_WORK + ("sit", "rehit", "near_maximal_lift", "pads_hard", "rolling_hard"):
        assert flag in rules.blocked_by(key, flags), key
    for key in ("walking_brisk", "continuous_moderate", "technical_drilling", "bag_slow", "sparring_light"):
        assert rules.allowed(key, flags), key


def test_no_all_out_sprints_takes_out_sit_and_rehit_only():
    flags = SafetyFlags(no_all_out_sprints=True)
    assert not rules.allowed("sit", flags) and not rules.allowed("rehit", flags)
    assert rules.allowed("hiit", flags) and rules.allowed("jump_rope", flags)


def test_no_contact_takes_out_contact_work():
    flags = SafetyFlags()
    assert rules.blocked_by("sparring_light", flags, no_contact=True) == ["no_contact"]
    assert rules.blocked_by("rolling_flow", flags, no_contact=True) == ["no_contact"]
    # R3-3: tras el golpe, la vuelta es por fases: nada vigoroso sin contacto hasta el alta
    assert rules.blocked_by("pads_hard", flags, no_contact=True) == ["head_blow_return"]
    assert rules.blocked_by("hiit", flags, no_contact=True) == ["head_blow_return"]
    assert rules.allowed("technical_drilling", flags, no_contact=True)
    assert rules.allowed("bag_slow", flags, no_contact=True)
    assert rules.allowed("pads_hard", flags, no_contact=False)


def test_no_training_takes_out_everything():
    flags = SafetyFlags(no_training=True)
    assert not any(rules.allowed(k, flags) for k in rules.MODALITY_INTENSITY)
