from django.urls import path

from .checkin_views import CheckinView
from .plan_views import PlanApplyView, PlanView
from .safety_views import (
    HeadImpactDetailView,
    HeadImpactListView,
    InjuryDetailView,
    InjuryListView,
    SafetyView,
    ScreeningView,
)
from .strength_views import StrengthE1rmView, StrengthProgressView, StrengthSetsView
from .targets_views import TargetsView, TrendView, WeighInView, ZonesView
from .views import EngineView, RuleDetailView, RuleSearchView, SourceDetailView

urlpatterns = [
    path("knowledge/rules", RuleSearchView.as_view(), name="knowledge-rules"),
    path("knowledge/rules/<path:key>", RuleDetailView.as_view(), name="knowledge-rule"),
    path("knowledge/sources/<str:sid>", SourceDetailView.as_view(), name="knowledge-source"),
    path("coach/engine", EngineView.as_view(), name="coach-engine"),
    path("coach/safety", SafetyView.as_view(), name="coach-safety"),
    path("coach/targets", TargetsView.as_view(), name="coach-targets"),
    path("coach/trend", TrendView.as_view(), name="coach-trend"),
    path("coach/zones", ZonesView.as_view(), name="coach-zones"),
    path("coach/weigh-in", WeighInView.as_view(), name="coach-weigh-in"),
    path("coach/checkin", CheckinView.as_view(), name="coach-checkin"),
    path("coach/plan", PlanView.as_view(), name="coach-plan"),
    path("coach/plan/<int:pk>/apply", PlanApplyView.as_view(), name="coach-plan-apply"),
    path("coach/strength/e1rm", StrengthE1rmView.as_view(), name="coach-strength-e1rm"),
    path("coach/strength/sets", StrengthSetsView.as_view(), name="coach-strength-sets"),
    path("coach/strength/progress", StrengthProgressView.as_view(), name="coach-strength-progress"),
    path("coach/screening", ScreeningView.as_view(), name="coach-screening"),
    path("coach/injuries", InjuryListView.as_view(), name="coach-injuries"),
    path("coach/injuries/<int:pk>", InjuryDetailView.as_view(), name="coach-injury"),
    path("coach/head-impacts", HeadImpactListView.as_view(), name="coach-head-impacts"),
    path("coach/head-impacts/<int:pk>", HeadImpactDetailView.as_view(), name="coach-head-impact"),
]
