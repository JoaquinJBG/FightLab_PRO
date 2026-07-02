from django.urls import path

from .views import ActivityDetailView, ActivityListView, ActivityMetricsView, ActivitySyncView

urlpatterns = [
    path("activities", ActivityListView.as_view(), name="activities"),
    path("activities/sync", ActivitySyncView.as_view(), name="activities-sync"),
    path("activities/metrics", ActivityMetricsView.as_view(), name="activities-metrics"),
    path("activities/<int:pk>", ActivityDetailView.as_view(), name="activities-detail"),
]
