from django.urls import path

from .views import (
    BiometricsDetailView,
    BiometricsListCreateView,
    PhotoDetailView,
    PhotoListCreateView,
    ProfileView,
)

urlpatterns = [
    path("me/profile", ProfileView.as_view(), name="profile"),
    path("me/biometrics", BiometricsListCreateView.as_view(), name="biometrics"),
    path("me/biometrics/<int:pk>", BiometricsDetailView.as_view(), name="biometrics-detail"),
    path("me/photos", PhotoListCreateView.as_view(), name="photos"),
    path("me/photos/<int:pk>", PhotoDetailView.as_view(), name="photos-detail"),
]
