"""Toda regla que cita el check-in existe en la base de evidencia (si no, el chip de evidencia
del frontend apuntaría a una página vacía)."""
import pytest

from coaching import readiness, redflags, trend
from coaching.models import KnowledgeRule

pytestmark = pytest.mark.django_db


def test_every_rule_the_checkin_cites_is_loaded(real_knowledge):
    keys = {key for _, key in redflags.LEVELS.values()}
    keys |= {readiness.READINESS_RULE, readiness.HRV_RULE, trend.TREND_RULE}
    missing = keys - set(KnowledgeRule.objects.values_list("key", flat=True))
    assert not missing
