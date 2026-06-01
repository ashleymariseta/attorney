"""JWT auth middleware for Channels — reads ?token=<access> from the WS URL."""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError


@database_sync_to_async
def _user_for(token):
    try:
        access = AccessToken(token)
    except TokenError:
        return AnonymousUser()
    user_id = access.get('user_id')
    if user_id is None:
        return AnonymousUser()
    User = get_user_model()
    try:
        return User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        token = ''
        qs = parse_qs(scope.get('query_string', b'').decode())
        if qs.get('token'):
            token = qs['token'][0]
        scope['user'] = await _user_for(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)
