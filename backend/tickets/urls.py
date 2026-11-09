from django.urls import path

from .views import TicketDetailView, TicketListView, TicketUrlView

urlpatterns = [
    path("tickets", TicketListView.as_view(), name="tickets"),
    path("tickets/<int:pk>", TicketDetailView.as_view(), name="ticket"),
    path("tickets/<int:pk>/url", TicketUrlView.as_view(), name="ticket-url"),
]
