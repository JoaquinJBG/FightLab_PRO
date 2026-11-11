from django.urls import path

from .views import (
    CatalogDetailView,
    CustomExerciseCreateView,
    CustomExerciseDetailView,
    ExerciseDetailView,
    ExerciseListView,
)

urlpatterns = [
    path("gym/exercises", ExerciseListView.as_view(), name="exercises"),
    path("gym/exercises/custom", CustomExerciseCreateView.as_view(), name="exercises-custom"),
    path("gym/exercises/custom/<int:pk>", CustomExerciseDetailView.as_view(), name="exercises-custom-detail"),
    path("gym/exercises/cat/<slug:slug>", CatalogDetailView.as_view(), name="exercises-catalog-detail"),
    path("gym/exercises/<str:key>", ExerciseDetailView.as_view(), name="exercises-detail"),
]
