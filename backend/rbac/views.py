from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.serializers import UserSerializer
from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND

from . import services
from .models import Permission, Role
from .permissions import require_permission
from .serializers import PermissionSerializer, RoleSerializer, RoleWriteSerializer


class UserListView(APIView):
    permission_classes = [require_permission("user.manage")]

    @extend_schema(tags=["RBAC"], summary="List all users", responses={200: UserSerializer(many=True), **COMMON_ERRORS})
    def get(self, request):
        return Response(UserSerializer(User.objects.all(), many=True).data)


class RoleListCreateView(APIView):
    permission_classes = [require_permission("role.manage")]

    @extend_schema(tags=["RBAC"], summary="List all roles", responses={200: RoleSerializer(many=True), **COMMON_ERRORS})
    def get(self, request):
        return Response(RoleSerializer(Role.objects.all(), many=True).data)

    @extend_schema(
        tags=["RBAC"],
        summary="Create a role",
        request=RoleWriteSerializer,
        responses={201: RoleSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = RoleWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = services.create_role(actor=request.user, request=request, **serializer.validated_data)
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


class RoleDetailView(APIView):
    permission_classes = [require_permission("role.manage")]

    @extend_schema(
        tags=["RBAC"], summary="Get a role", responses={200: RoleSerializer, 404: NOT_FOUND, **COMMON_ERRORS}
    )
    def get(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        return Response(RoleSerializer(role).data)

    @extend_schema(
        tags=["RBAC"],
        summary="Update a role's name/description",
        request=RoleWriteSerializer,
        responses={200: RoleSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        serializer = RoleWriteSerializer(role, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        role = services.update_role(role=role, actor=request.user, request=request, **serializer.validated_data)
        return Response(RoleSerializer(role).data)

    @extend_schema(
        tags=["RBAC"],
        summary="Delete a role",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        services.delete_role(role=role, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PermissionListView(APIView):
    permission_classes = [require_permission("permission.manage")]

    @extend_schema(
        tags=["RBAC"],
        summary="List all permission codenames (read-only - the catalogue comes from code + seeding)",
        responses={200: PermissionSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        return Response(PermissionSerializer(Permission.objects.all(), many=True).data)


class RolePermissionsView(APIView):
    permission_classes = [require_permission("permission.manage")]

    @extend_schema(
        tags=["RBAC"],
        summary="List a role's granted permissions",
        responses={200: PermissionSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        return Response(PermissionSerializer(role.permissions.all(), many=True).data)

    @extend_schema(
        tags=["RBAC"],
        summary="Grant a permission to a role",
        request={"application/json": {"type": "object", "properties": {"permission_id": {"type": "string", "format": "uuid"}}}},
        responses={200: PermissionSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        permission = get_object_or_404(Permission, pk=request.data.get("permission_id"))
        services.grant_permission(role=role, permission=permission, actor=request.user, request=request)
        return Response(PermissionSerializer(role.permissions.all(), many=True).data)


class RolePermissionDetailView(APIView):
    permission_classes = [require_permission("permission.manage")]

    @extend_schema(
        tags=["RBAC"],
        summary="Revoke a permission from a role",
        responses={204: OpenApiResponse(description="Revoked (or was already absent)."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, permission_id):
        role = get_object_or_404(Role, pk=pk)
        permission = get_object_or_404(Permission, pk=permission_id)
        services.revoke_permission(role=role, permission=permission, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserRolesView(APIView):
    permission_classes = [require_permission("user.manage")]

    @extend_schema(
        tags=["RBAC"],
        summary="Assign a role to a user",
        request={"application/json": {"type": "object", "properties": {"role_id": {"type": "string", "format": "uuid"}}}},
        responses={204: OpenApiResponse(description="Assigned (or already held)."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        role = get_object_or_404(Role, pk=request.data.get("role_id"))
        services.assign_role(user=user, role=role, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserRoleDetailView(APIView):
    permission_classes = [require_permission("user.manage")]

    @extend_schema(
        tags=["RBAC"],
        summary="Unassign a role from a user",
        responses={204: OpenApiResponse(description="Unassigned (or was not held)."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, role_id):
        user = get_object_or_404(User, pk=pk)
        role = get_object_or_404(Role, pk=role_id)
        services.unassign_role(user=user, role=role, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
