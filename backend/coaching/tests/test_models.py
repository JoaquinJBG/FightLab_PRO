import pytest
from django.db import IntegrityError

from coaching.models import KnowledgeRule, KnowledgeSource, RuleTranslation


@pytest.mark.django_db
def test_rule_key_is_unique():
    KnowledgeRule.objects.create(key="nutrition/a", file="nutrition", heading="A")
    with pytest.raises(IntegrityError):
        KnowledgeRule.objects.create(key="nutrition/a", file="nutrition", heading="B")


@pytest.mark.django_db
def test_translation_is_unique_per_rule_and_language():
    rule = KnowledgeRule.objects.create(key="nutrition/a", file="nutrition", heading="A")
    RuleTranslation.objects.create(rule=rule, lang="es", status="machine")
    with pytest.raises(IntegrityError):
        RuleTranslation.objects.create(rule=rule, lang="es", status="reviewed")


@pytest.mark.django_db
def test_defaults():
    rule = KnowledgeRule.objects.create(key="nutrition/a", file="nutrition", heading="A")
    assert rule.origin == "upstream"
    assert rule.retired is False
    assert rule.source_ids == []
    src = KnowledgeSource.objects.create(sid="S001", citation="Doe 2020")
    assert src.doi == "" and src.url == ""
    assert not hasattr(src, "supports")


@pytest.mark.django_db
def test_real_index_has_459_unique_keys_and_859_sources(real_knowledge):
    assert KnowledgeRule.objects.count() == 459
    assert KnowledgeRule.objects.values("key").distinct().count() == 459
    assert KnowledgeSource.objects.count() == 859


@pytest.mark.django_db
def test_no_loaded_source_contains_the_quoted_text(real_knowledge):
    """Las líneas `Supports:` son de las editoriales: no se guardan (spec §1, licencias)."""
    for src in KnowledgeSource.objects.all():
        for field in ("citation", "type", "doi", "url"):
            assert "Supports:" not in getattr(src, field)
    s819 = KnowledgeSource.objects.get(sid="S819")
    blob = " ".join(str(getattr(s819, f.name)) for f in s819._meta.fields)
    assert "498 healthy subjects" not in blob
    assert s819.doi == "10.1093/ajcn/51.2.241"
    assert s819.type == "Other"
    assert s819.url.startswith("https://pubmed.ncbi.nlm.nih.gov/")
