from django.urls import path

from .views import CronRemindersView, PushPrefsView, PushSubscribeView, PushTestView, PushUnsubscribeView, PushView

urlpatterns = [
    path("me/push", PushView.as_view(), name="push"),
    path("me/push/subscribe", PushSubscribeView.as_view(), name="push-subscribe"),
    path("me/push/unsubscribe", PushUnsubscribeView.as_view(), name="push-unsubscribe"),
    path("me/push/prefs", PushPrefsView.as_view(), name="push-prefs"),
    path("me/push/test", PushTestView.as_view(), name="push-test"),
    path("cron/reminders", CronRemindersView.as_view(), name="cron-reminders"),
]
