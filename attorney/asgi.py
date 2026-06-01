import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attorney.settings')

# Initialise Django's app registry before importing anything that touches models
# (Channels routing imports consumers that may reference the ORM).
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
from django.conf import settings as dj_settings  # noqa: E402

from core.routing import websocket_urlpatterns  # noqa: E402
from core.ws_auth import JWTAuthMiddleware  # noqa: E402


class _AllowOriginInDebug:
    """Wrapper that bypasses origin validation in DEBUG, otherwise delegates."""

    def __init__(self, inner):
        self.inner = inner
        self.validator = AllowedHostsOriginValidator(inner)

    async def __call__(self, scope, receive, send):
        if getattr(dj_settings, 'DEBUG', False):
            return await self.inner(scope, receive, send)
        return await self.validator(scope, receive, send)


ws_inner = JWTAuthMiddleware(AuthMiddlewareStack(URLRouter(websocket_urlpatterns)))

application = ProtocolTypeRouter(
    {
        'http': django_asgi_app,
        'websocket': _AllowOriginInDebug(ws_inner),
    }
)
