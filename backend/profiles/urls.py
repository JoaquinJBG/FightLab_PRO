from django.urls import path

from .views import BiometricsDetailView, BiometricsListCreateView, ProfileView

urlpatterns = [
    path("me/profile", ProfileView.as_view(), name="profile"),
    path("me/biometrics", BiometricsListCreateView.as_view(), name="biometrics"),
    path("me/biometrics/<int:pk>", BiometricsDetailView.as_view(), name="biometrics-detail"),
]
