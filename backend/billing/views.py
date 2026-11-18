from dataclasses import asdict

from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import COMMON_ERRORS
from platform_admin.models import PlatformSettings, subscriptions_enabled

from .serializers import OrganizationSubscriptionSerializer
from .services import evaluate, subscription_of, usage


class OrganizationSubscriptionView(APIView):
    @extend_schema(
        tags=["Billing"],
        summary="The caller's organization's subscription status, limits, price and how to pay",
        responses={200: OrganizationSubscriptionSerializer, **COMMON_ERRORS},
    )
    def get(self, request):
        organization = request.user.organization
        subscription = subscription_of(organization)
        access = evaluate(subscription)
        enabled = subscriptions_enabled()
        platform = PlatformSettings.load()
        is_org_admin = request.user.has_permission("organization.manage")
        return Response(
            OrganizationSubscriptionSerializer(
                {
                    **asdict(access),
                    **usage(organization),
                    "enabled": enabled,
                    "read_only": enabled and access.expired,
                    "price": platform.subscription_price,
                    "currency": platform.subscription_currency,
                    "payment_instructions": platform.subscription_payment_instructions,
                    "max_users": subscription.max_users if subscription else None,
                    "max_storage_gb": subscription.max_storage_gb if subscription else None,
                    "payments": list(subscription.payments.all()) if subscription and is_org_admin else [],
                }
            ).data
        )
