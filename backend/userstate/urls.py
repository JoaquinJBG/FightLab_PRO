from django.urls import path

from .views import StateDetailView, StateView

urlpatterns = [
    path("me/state", StateView.as_view(), name="user-state"),
    path("me/state/<str:key>", StateDetailView.as_view(), name="user-state-detail"),
]
