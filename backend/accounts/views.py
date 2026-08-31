from django.conf import settings
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from audit.services import log_action
from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND, UNAUTHORIZED
from config.pagination import paginated_response
from rbac.permissions import require_permission

from .models import InvitationCode, User
from .serializers import (
    CustomTokenObtainPairSerializer,
    InvitationCodeCreateSerializer,
    InvitationCodeSerializer,
    MeUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
)
from .services import create_invitation_code, register_user, revoke_invitation_code, update_own_profile


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        settings.JWT_REFRESH_COOKIE_NAME,
        refresh_token,
        httponly=True,
        secure=settings.JWT_REFRESH_COOKIE_SECURE,
        samesite=settings.JWT_REFRESH_COOKIE_SAMESITE,
        domain=settings.JWT_REFRESH_COOKIE_DOMAIN,
        path=settings.JWT_REFRESH_COOKIE_PATH,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        settings.JWT_REFRESH_COOKIE_NAME,
        domain=settings.JWT_REFRESH_COOKIE_DOMAIN,
        path=settings.JWT_REFRESH_COOKIE_PATH,
    )


class LoginView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        tags=["Auth"],
        summary="Log in and receive an access token + httpOnly refresh cookie",
        responses={
            200: OpenApiResponse(
                description="The refresh token is set as an httpOnly cookie, "
                "never returned in the response body."
            ),
            401: OpenApiResponse(description="Invalid credentials."),
        },
    )
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        refresh_token = response.data.pop("refresh", None)
        if refresh_token:
            _set_refresh_cookie(response, refresh_token)
            user_id = response.data.get("user", {}).get("id")
            actor = User.objects.filter(pk=user_id).first() if user_id else None
            log_action(actor=actor, action="auth.login", target=actor, request=request)
        return response


class RefreshView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        tags=["Auth"],
        summary="Exchange the httpOnly refresh cookie for a new access token",
        request=None,
        responses={
            200: OpenApiResponse(description="A new access token; the refresh cookie is rotated."),
            401: OpenApiResponse(description="Refresh cookie missing, expired, invalid, or blacklisted."),
        },
    )
    def post(self, request, *args, **kwargs):
        refresh_token = request.COOKIES.get(settings.JWT_REFRESH_COOKIE_NAME)
        if not refresh_token:
            raise AuthenticationFailed("No refresh token cookie present.")

        serializer = TokenRefreshSerializer(data={"refresh": refresh_token})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as exc:
            raise AuthenticationFailed(str(exc)) from exc

        data = dict(serializer.validated_data)
        rotated_refresh = data.pop("refresh", None)
        response = Response(data, status=status.HTTP_200_OK)
        if rotated_refresh:
            _set_refresh_cookie(response, rotated_refresh)
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Auth"],
        summary="Blacklist the refresh token and clear the refresh cookie",
        request=None,
        responses={204: OpenApiResponse(description="Logged out.")},
    )
    def post(self, request, *args, **kwargs):
        refresh_token = request.COOKIES.get(settings.JWT_REFRESH_COOKIE_NAME)
        if refresh_token:
            try:
                RefreshToken(refresh_token).blacklist()
            except TokenError:
                pass

        actor = request.user if request.user.is_authenticated else None
        log_action(actor=actor, action="auth.logout", request=request)

        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_refresh_cookie(response)
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Auth"],
        summary="Get the current authenticated user, their roles, and permission codenames",
        responses={200: UserSerializer, 401: UNAUTHORIZED},
    )
    def get(self, request, *args, **kwargs):
        return Response(UserSerializer(request.user).data)

    @extend_schema(
        tags=["Auth"],
        summary="Update the current user's own profile (name, title, preferences) - not email/password/roles",
        request=MeUpdateSerializer,
        responses={200: UserSerializer, 400: BAD_REQUEST, 401: UNAUTHORIZED},
    )
    def patch(self, request, *args, **kwargs):
        serializer = MeUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = update_own_profile(actor=request.user, request=request, **serializer.validated_data)
        return Response(UserSerializer(user).data)


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        tags=["Auth"],
        summary="Self-register a new account with an invitation code (assigned the Guest role)",
        request=RegisterSerializer,
        responses={
            201: UserSerializer,
            400: OpenApiResponse(
                description="Validation failed, or invitation_code is missing/invalid/expired/exhausted."
            ),
            404: OpenApiResponse(description="Registration is disabled (ENABLE_REGISTRATION=False)."),
        },
    )
    def post(self, request, *args, **kwargs):
        if not settings.ENABLE_REGISTRATION:
            return Response(status=status.HTTP_404_NOT_FOUND)

        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = register_user(request=request, **serializer.validated_data)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class InvitationCodeListCreateView(APIView):
    permission_classes = [require_permission("user.manage")]

    @extend_schema(
        tags=["Auth"],
        summary="List invitation codes",
        responses={200: InvitationCodeSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        return paginated_response(request, InvitationCode.objects.all(), InvitationCodeSerializer)

    @extend_schema(
        tags=["Auth"],
        summary="Generate an invitation code",
        request=InvitationCodeCreateSerializer,
        responses={201: InvitationCodeSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = InvitationCodeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitation = create_invitation_code(created_by=request.user, request=request, **serializer.validated_data)
        return Response(InvitationCodeSerializer(invitation).data, status=status.HTTP_201_CREATED)


class InvitationCodeRevokeView(APIView):
    permission_classes = [require_permission("user.manage")]

    @extend_schema(
        tags=["Auth"],
        summary="Revoke an invitation code",
        request=None,
        responses={200: InvitationCodeSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        invitation = get_object_or_404(InvitationCode, pk=pk)
        invitation = revoke_invitation_code(invitation=invitation, actor=request.user, request=request)
        return Response(InvitationCodeSerializer(invitation).data)