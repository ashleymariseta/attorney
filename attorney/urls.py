from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve as media_serve
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)


def healthz(_request):
    """Liveness + readiness probe. DB roundtrip + 200 means we're good."""
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
        return JsonResponse({'status': 'ok', 'db': 'ok'})
    except Exception as exc:  # pragma: no cover
        return JsonResponse({'status': 'error', 'db': str(exc)}, status=503)


urlpatterns = [
    path('admin/', admin.site.urls),
    path('healthz', healthz, name='healthz'),
    path('api/v1/', include('core.urls')),
    path('api/v1/payments/', include('payments.urls')),
    path('api/v1/', include('workflows.urls')),
    path('api/v1/', include('corpus.urls')),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
]

# Serve uploaded media (avatars, KYC certificates, proofs of payment). The
# `static()` helper only wires this up under DEBUG; in production Django serves
# nothing by default, so /media/ 404s and images render as a broken "?". Unless
# a dedicated media server / CDN is put in front (set SERVE_MEDIA=false then),
# fall back to letting Django serve /media/ directly.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
elif getattr(settings, 'SERVE_MEDIA', True):
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', media_serve, {'document_root': settings.MEDIA_ROOT}),
    ]
