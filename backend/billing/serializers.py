from rest_framework import serializers

from .services import Status


class OrganizationPaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    currency = serializers.CharField()
    paid_on = serializers.DateField()
    period_start = serializers.DateTimeField()
    period_end = serializers.DateTimeField()
    reference = serializers.CharField()


class OrganizationSubscriptionSerializer(serializers.Serializer):
    """What a member of an org sees about its subscription (drives the renewal banner and the
    read-only notice). `payments` is only filled for organization admins (organization.manage);
    platform-admin notes are never included."""

    enabled = serializers.BooleanField(help_text="Whether subscriptions are enforced on this instance.")
    status = serializers.ChoiceField(choices=Status.choices)
    read_only = serializers.BooleanField()
    access_until = serializers.DateTimeField(allow_null=True)
    read_only_from = serializers.DateTimeField(allow_null=True)
    renewal_due = serializers.BooleanField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    currency = serializers.CharField()
    payment_instructions = serializers.CharField(allow_blank=True)
    max_users = serializers.IntegerField(allow_null=True)
    max_storage_gb = serializers.IntegerField(allow_null=True)
    user_count = serializers.IntegerField()
    storage_bytes = serializers.IntegerField()
    payments = OrganizationPaymentSerializer(many=True)
