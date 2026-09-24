from django.urls import path

from .views import StateBulkView, StateDetailView, StateView

urlpatterns = [
    path("me/state", StateView.as_view(), name="user-state"),
    # Antes de <str:key>: si no, "bulk" se colaría ahí como una clave más.
    path("me/state/bulk", StateBulkView.as_view(), name="user-state-bulk"),
    path("me/state/<str:key>", StateDetailView.as_view(), name="user-state-detail"),
]
