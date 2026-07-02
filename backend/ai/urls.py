from django.urls import path

from .views import CoachChatView, FoodPhotoView

urlpatterns = [
    path("ai/coach/chat", CoachChatView.as_view(), name="ai-coach-chat"),
    path("ai/food/analyze", FoodPhotoView.as_view(), name="ai-food-analyze"),
]
