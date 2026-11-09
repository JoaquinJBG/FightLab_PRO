from django.urls import path

from .views import TicketDetailView, TicketListView, TicketUrlView

urlpatterns = [
    path("coach/tickets", TicketListView.as_view(), name="tickets"),
    path("coach/tickets/<int:pk>", TicketDetailView.as_view(), name="ticket"),
    path("coach/tickets/<int:pk>/url", TicketUrlView.as_view(), name="ticket-url"),
]
