import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attorney.settings')

# Initialise Django's app registry before importing anything that touches models
# (Channels routing imports consumers that may reference the ORM).
django_asgi_app = get_asgi_application()

from urllib.parse import urlparse  # noqa: E402

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator  # noqa: E402
from django.conf import settings as dj_settings  # noqa: E402

from core.routing import websocket_urlpatterns  # noqa: E402
from core.ws_auth import JWTAuthMiddleware  # noqa: E402


def _ws_allowed_origins():
    """Browser origins allowed to open a websocket. The frontend usually lives
    on a different host than the API, so validating against ALLOWED_HOSTS (the
    API's own hostnames) wrongly rejects it — hence the endless "connecting" in
    production. Trust the same origins we already trust for CSRF/CORS, plus our
    own hosts for same-origin setups."""
    hosts = []
    seen = set()

    def add(host):
        host = (host or '').strip()
        if host and host not in seen:
            seen.add(host)
            hosts.append(host)

    for origin in (
        list(getattr(dj_settings, 'CSRF_TRUSTED_ORIGINS', []))
        + list(getattr(dj_settings, 'CORS_ALLOWED_ORIGINS', []))
    ):
        add(urlparse(origin).hostname)
    for host in getattr(dj_settings, 'ALLOWED_HOSTS', []):
        if host.strip() == '*':
            return ['*']
        add(host)
    return hosts or ['*']


class _AllowOriginInDebug:
    """Wrapper that bypasses origin validation in DEBUG, otherwise validates the
    websocket Origin against the trusted frontend origins."""

    def __init__(self, inner):
        self.inner = inner
        self.validator = OriginValidator(inner, _ws_allowed_origins())

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
