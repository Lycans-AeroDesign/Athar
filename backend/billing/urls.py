from django.urls import path

from .views import OrganizationSubscriptionView

urlpatterns = [
    path("subscription/", OrganizationSubscriptionView.as_view(), name="billing-subscription"),
]
