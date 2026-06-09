"""Django settings for the Attorney platform."""
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    SECRET_KEY=(str, 'unsafe-secret-key'),
    ALLOWED_HOSTS=(str, 'localhost,127.0.0.1'),
    DATABASE_URL=(str, 'sqlite:///db.sqlite3'),
    REDIS_URL=(str, 'redis://127.0.0.1:6379/0'),
    CORS_ALLOWED_ORIGINS=(str, 'http://localhost:3000,http://127.0.0.1:3000'),
    CSRF_TRUSTED_ORIGINS=(str, 'http://localhost:3000,http://127.0.0.1:3000'),
)

env_file = BASE_DIR / '.env'
if env_file.exists():
    environ.Env.read_env(env_file)

SECRET_KEY = env('SECRET_KEY')
DEBUG = env('DEBUG')
ALLOWED_HOSTS = [host.strip() for host in env('ALLOWED_HOSTS').split(',') if host.strip()]

INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt.token_blacklist',
    'drf_spectacular',
    'channels',
    'core',
    'payments',
    'workflows',
    'corpus',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    # WhiteNoise serves /static/ in any environment so a single container can
    # ship the admin assets without a separate nginx layer.
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'attorney.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'attorney.wsgi.application'
ASGI_APPLICATION = 'attorney.asgi.application'

DATABASES = {
    'default': env.db(),
}

# Resolve a relative SQLite path against BASE_DIR so the database is found
# regardless of the process working directory.
_db = DATABASES['default']
if 'sqlite' in _db.get('ENGINE', '') and _db.get('NAME') and not Path(_db['NAME']).is_absolute():
    _db['NAME'] = str(BASE_DIR / _db['NAME'])

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

# Media (Proof-of-Payment uploads, KYC docs, etc.).
# v1 uses local storage; swap DEFAULT_FILE_STORAGE for an S3 backend in production.
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_USER_MODEL = 'core.User'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 25,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': env.str('THROTTLE_ANON', '60/minute'),
        'user': env.str('THROTTLE_USER', '500/minute'),
        # Hot scopes — applied per-view via throttle_scope.
        'auth': env.str('THROTTLE_AUTH', '10/minute'),
        'invite_accept': env.str('THROTTLE_INVITE', '20/hour'),
        'password_reset': env.str('THROTTLE_PASSWORD_RESET', '5/hour'),
    },
}

# Production security defaults. When DEBUG is off, lock cookies + headers.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', 31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = 'same-origin'
    X_FRAME_OPTIONS = 'DENY'

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'Attorney API',
    'DESCRIPTION': 'REST API for the Attorney platform — verified legal counsel, on demand.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
}

CORS_ALLOWED_ORIGINS = [
    origin.strip() for origin in env('CORS_ALLOWED_ORIGINS').split(',') if origin.strip()
]
CSRF_TRUSTED_ORIGINS = [
    origin.strip() for origin in env('CSRF_TRUSTED_ORIGINS').split(',') if origin.strip()
]

# Channel layer — defaults to in-memory for dev (no extra services). Set
# CHANNEL_BACKEND=redis (and a working REDIS_URL) to scale across workers.
if env.str('CHANNEL_BACKEND', 'memory') == 'redis':
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [env('REDIS_URL', default='redis://127.0.0.1:6379/0')]},
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
    }

# Celery
CELERY_BROKER_URL = env('REDIS_URL')
CELERY_RESULT_BACKEND = env('REDIS_URL')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

# Security hardening — on by default in production, env-overridable.
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=not DEBUG)
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=not DEBUG)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=not DEBUG)
if not DEBUG:
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'root': {
        'handlers': ['console'],
        'level': env.str('LOG_LEVEL', 'INFO'),
    },
}

# Email — defaults to console for local development. Override with SMTP creds
# in production via EMAIL_BACKEND, EMAIL_HOST, etc.
EMAIL_BACKEND = env.str('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
EMAIL_HOST = env.str('EMAIL_HOST', '')
EMAIL_PORT = env.int('EMAIL_PORT', 587)
EMAIL_HOST_USER = env.str('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = env.str('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', True)
DEFAULT_FROM_EMAIL = env.str('DEFAULT_FROM_EMAIL', 'Attorney <no-reply@attorney.local>')
INVITE_ACCEPT_URL = env.str('INVITE_ACCEPT_URL', 'http://localhost:3000/accept-invite')
PASSWORD_RESET_URL = env.str('PASSWORD_RESET_URL', 'http://localhost:3000/reset-password')
EMAIL_VERIFY_URL = env.str('EMAIL_VERIFY_URL', 'http://localhost:3000/verify-email')

# WhatsApp delivery for 2FA codes. When unset, codes are logged to the console
# only — wire a real provider (Twilio, Meta Cloud API, etc.) in production.
WHATSAPP_API_URL = env.str('WHATSAPP_API_URL', '')
WHATSAPP_API_TOKEN = env.str('WHATSAPP_API_TOKEN', '')

# Sentry — opt-in. If SENTRY_DSN is set and sentry-sdk is installed, errors
# and slow requests get reported. Otherwise this is a silent no-op.
SENTRY_DSN = env.str('SENTRY_DSN', '')
if SENTRY_DSN:
    try:
        import sentry_sdk  # type: ignore
        from sentry_sdk.integrations.django import DjangoIntegration  # type: ignore

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[DjangoIntegration()],
            environment=env.str('SENTRY_ENV', 'production' if not DEBUG else 'development'),
            traces_sample_rate=env.float('SENTRY_TRACES_SAMPLE_RATE', 0.1),
            send_default_pii=False,
        )
    except ImportError:  # pragma: no cover
        pass
