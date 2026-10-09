from django.urls import path

from .views import AcceptPoliciesView, CurrentPoliciesView, PolicyDraftView, PolicyOverviewView, PolicyPublishView

urlpatterns = [
    path("", CurrentPoliciesView.as_view(), name="policies-current"),
    path("accept/", AcceptPoliciesView.as_view(), name="policies-accept"),
    path("manage/", PolicyOverviewView.as_view(), name="policies-manage"),
    path("manage/<str:kind>/draft/", PolicyDraftView.as_view(), name="policies-draft"),
    path("manage/<str:kind>/publish/", PolicyPublishView.as_view(), name="policies-publish"),
]
