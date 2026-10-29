"""API de lectura de la base de evidencia (spec §7.1). Solo usuarios autenticados.

Nada de esto tiene datos personales. Las fuentes salen sin la línea `Supports:`, que nunca
se carga (citas de las editoriales).
"""
from coach import knowledge as coach_knowledge
from django.db.models import Max, Q
from django.http import Http404
from django.utils.translation import get_language
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .engine import ENGINE_SHA
from .models import KnowledgeRule, KnowledgeSource, RuleTranslation

SEARCH_LIMIT = 50
SOURCE_FIELDS = ("sid", "citation", "type", "doi", "url")
TEXT_FIELDS = ("heading", "rule_text", "evidence", "applies_to", "conflicts")
SOURCE_ORIGINAL_LANG = "en"


def request_language() -> str:
    return (get_language() or "es").split("-")[0]


def source_data(source: KnowledgeSource) -> dict:
    return {f: getattr(source, f) for f in SOURCE_FIELDS}


def translation_data(rule: KnowledgeRule, lang: str) -> dict | None:
    """La traducción en el idioma de la petición; en inglés se muestra el original."""
    if lang == SOURCE_ORIGINAL_LANG:
        return None
    tr = RuleTranslation.objects.filter(rule=rule, lang=lang).first()
    if tr is None:
        return None
    return {"lang": tr.lang, "status": tr.status, **{f: getattr(tr, f) for f in TEXT_FIELDS}}


def rule_summary(rule: KnowledgeRule, title: str | None = None) -> dict:
    return {
        "key": rule.key,
        "file": rule.file,
        "section": rule.section,
        "heading": rule.heading,
        "title": title or rule.heading,
        "grade": rule.grade,
    }


def rule_detail(rule: KnowledgeRule, lang: str) -> dict:
    by_sid = {s.sid: s for s in KnowledgeSource.objects.filter(sid__in=rule.source_ids)}
    return {
        **rule_summary(rule),
        "origin": rule.origin,
        "checked_on": rule.checked_on.isoformat() if rule.checked_on else None,
        "retired": rule.retired,
        "engine_sha": rule.engine_sha,
        **{f: getattr(rule, f) for f in TEXT_FIELDS if f != "heading"},
        "translation": translation_data(rule, lang),
        "sources": [source_data(by_sid[sid]) for sid in rule.source_ids if sid in by_sid],
    }


class RuleDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, key):
        rule = KnowledgeRule.objects.filter(key=key).first()
        if rule is None:
            raise Http404
        return Response(rule_detail(rule, request_language()))


class RuleSearchView(APIView):
    """`GET /knowledge/rules?q=`: por encabezado y sección (y por el encabezado traducido)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = request.query_params.get("q", "").strip()
        if not q:
            return Response({"results": []})
        lang = request_language()
        match = Q(heading__icontains=q) | Q(section__icontains=q)
        if lang != SOURCE_ORIGINAL_LANG:
            match |= Q(translations__lang=lang, translations__heading__icontains=q)
        rules = KnowledgeRule.objects.filter(match, retired=False).distinct().order_by("file", "key")[:SEARCH_LIMIT]
        titles = {}
        if lang != SOURCE_ORIGINAL_LANG:
            titles = {
                t.rule_id: t.heading
                for t in RuleTranslation.objects.filter(rule__in=rules, lang=lang).exclude(heading="")
            }
        return Response({"results": [rule_summary(r, titles.get(r.pk)) for r in rules]})


class SourceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, sid):
        source = KnowledgeSource.objects.filter(sid=sid).first()
        if source is None:
            raise Http404
        return Response(source_data(source))


class EngineView(APIView):
    """`GET /coach/engine`: versión del motor y fecha de la evidencia (pantalla de Créditos)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        checked = KnowledgeRule.objects.filter(origin="upstream", retired=False).aggregate(d=Max("checked_on"))["d"]
        if checked is None:  # aún no se ha cargado `load_knowledge`: se lee de los archivos
            dates = [
                coach_knowledge.checked_date(coach_knowledge.read(p)) for p in coach_knowledge.rule_files()
            ]
            checked = max((d for d in dates if d), default=None)
        return Response(
            {
                "sha": ENGINE_SHA[:7],
                "sha_full": ENGINE_SHA,
                "knowledge_checked_on": checked.isoformat() if checked else None,
            }
        )
