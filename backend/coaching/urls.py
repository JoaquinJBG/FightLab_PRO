from django.urls import path

from .safety_views import (
    HeadImpactDetailView,
    HeadImpactListView,
    InjuryDetailView,
    InjuryListView,
    SafetyView,
    ScreeningView,
)
from .targets_views import TargetsView, WeighInView, ZonesView
from .views import EngineView, RuleDetailView, RuleSearchView, SourceDetailView

urlpatterns = [
    path("knowledge/rules", RuleSearchView.as_view(), name="knowledge-rules"),
    path("knowledge/rules/<path:key>", RuleDetailView.as_view(), name="knowledge-rule"),
    path("knowledge/sources/<str:sid>", SourceDetailView.as_view(), name="knowledge-source"),
    path("coach/engine", EngineView.as_view(), name="coach-engine"),
    path("coach/safety", SafetyView.as_view(), name="coach-safety"),
    path("coach/targets", TargetsView.as_view(), name="coach-targets"),
    path("coach/zones", ZonesView.as_view(), name="coach-zones"),
    path("coach/weigh-in", WeighInView.as_view(), name="coach-weigh-in"),
    path("coach/screening", ScreeningView.as_view(), name="coach-screening"),
    path("coach/injuries", InjuryListView.as_view(), name="coach-injuries"),
    path("coach/injuries/<int:pk>", InjuryDetailView.as_view(), name="coach-injury"),
    path("coach/head-impacts", HeadImpactListView.as_view(), name="coach-head-impacts"),
    path("coach/head-impacts/<int:pk>", HeadImpactDetailView.as_view(), name="coach-head-impact"),
]
