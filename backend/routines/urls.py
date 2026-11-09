from django.urls import path

from . import views

urlpatterns = [
    path("gym/routine-folders", views.FolderListView.as_view(), name="gym-routine-folders"),
    path("gym/routine-folders/reorder", views.FolderReorderView.as_view(), name="gym-routine-folders-reorder"),
    path("gym/routine-folders/<int:pk>", views.FolderDetailView.as_view(), name="gym-routine-folder"),
    path("gym/routines", views.RoutineListView.as_view(), name="gym-routines"),
    path("gym/routines/reorder", views.RoutineReorderView.as_view(), name="gym-routines-reorder"),
    path("gym/routines/<int:pk>", views.RoutineDetailView.as_view(), name="gym-routine"),
    path("gym/routines/<int:pk>/duplicate", views.RoutineDuplicateView.as_view(), name="gym-routine-duplicate"),
    path("gym/routines/<int:pk>/start", views.RoutineStartView.as_view(), name="gym-routine-start"),
    path("gym/programs", views.ProgramListView.as_view(), name="gym-programs"),
    path("gym/programs/<slug:slug>", views.ProgramDetailView.as_view(), name="gym-program"),
    path("gym/programs/<slug:slug>/load", views.ProgramLoadView.as_view(), name="gym-program-load"),
    path("gym/plan-routines", views.PlanRoutinesView.as_view(), name="gym-plan-routines"),
    path("gym/plan-routines/sync", views.PlanRoutinesSyncView.as_view(), name="gym-plan-routines-sync"),
]
