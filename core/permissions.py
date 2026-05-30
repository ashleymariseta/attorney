from rest_framework import permissions


class IsAdminOrSelf(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.user.is_superuser or obj == request.user


class IsLawyer(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == 'lawyer'


class IsMatterMember(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if hasattr(obj, 'members'):
            return request.user in obj.members.all()
        if hasattr(obj, 'matter'):
            return request.user == obj.matter.client or request.user in obj.matter.lawyers.all()
        return False
