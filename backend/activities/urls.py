from django.urls import path

from .views import (
    ActivityCalendarView,
    ActivityDetailView,
    ActivityListView,
    ActivityMetricsView,
    ActivitySyncView,
    GymProgressView,
    GymRecordsView,
)

urlpatterns = [
    path("activities", ActivityListView.as_view(), name="activities"),
    path("activities/sync", ActivitySyncView.as_view(), name="activities-sync"),
    path("activities/metrics", ActivityMetricsView.as_view(), name="activities-metrics"),
    path("activities/calendar", ActivityCalendarView.as_view(), name="activities-calendar"),
    path("activities/<int:pk>", ActivityDetailView.as_view(), name="activities-detail"),
    # F17 (rama H): récords y progreso por ejercicio, junto a las rutas `gym/` de E y R.
    path("gym/records", GymRecordsView.as_view(), name="gym-records"),
    path("gym/progress", GymProgressView.as_view(), name="gym-progress"),
]
