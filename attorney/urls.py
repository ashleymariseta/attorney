from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path
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

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
