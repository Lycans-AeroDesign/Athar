"""Django settings for the Athar backend."""

import sys
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, True),
)
# Local dev convenience: `docker-compose` and CI inject real env vars directly,
# but running manage.py on a bare host still picks up backend/.env if present.
environ.Env.read_env(BASE_DIR / ".env")


# Development defaults, unsuitable for production.

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env(
    "SECRET_KEY",
    default="django-insecure-vjy1t2t(ho=1=q)l9%0vm$vwu7(ai-mjzje*%q%8vr@1-dkm7(",
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env.bool("DEBUG", default=True)

ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])

# Trust nginx's X-Forwarded-Proto: the app always sits behind nginx, which sets the header
# from its own $scheme, so Django never sees a client-supplied value.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# Outside DEBUG everything arrives over HTTPS (nginx redirects port 80), so Django's cookies
# can be Secure. HSTS is opt-in: browsers refuse plain HTTP for that long once it's set, so
# enable it only after HTTPS works (e.g. SECURE_HSTS_SECONDS=31536000).
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=0)


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Full-text search and trigram similarity (pg_trgm), see knowledge/search.py.
    "django.contrib.postgres",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "core",
    "accounts",
    "rbac",
    "audit",
    "files",
    "organization",
    "knowledge",
    "training",
    "backups",
    "policies",
]

AUTH_USER_MODEL = "accounts.User"

# Login accepts email or the optional username (accounts/backends.py); replaces the default
# ModelBackend, whose behavior it covers.
AUTHENTICATION_BACKENDS = ["accounts.backends.EmailOrUsernameBackend"]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database

DATABASES = {
    # No SQLite fallback - DATABASE_URL (Postgres) is required in every
    # environment, dev included. Raises ImproperlyConfigured if unset.
    "default": env.db("DATABASE_URL"),
}
# knowledge.search's trigram fallback filters with the GIN-indexable %>
# operator, which compares against this per-session setting (pg_trgm's own
# default is 0.6) - see knowledge.search.TRIGRAM_THRESHOLD.
_db_options = DATABASES["default"].setdefault("OPTIONS", {})
_db_options["options"] = f"{_db_options.get('options', '')} -c pg_trgm.word_similarity_threshold=0.4".strip()


# Password validation

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.1/howto/static-files/

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# In DEBUG, skip collectstatic (see docker/entrypoint.sh): WhiteNoise serves from each
# app's static/ dir via the finders, and {% static %} skips the hash manifest.
if DEBUG:
    WHITENOISE_USE_FINDERS = True
    WHITENOISE_AUTOREFRESH = True

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        ),
    },
}

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# --- S3-compatible object storage (opt-in) ------------------------------
# Local disk is the default. Set AWS_STORAGE_BUCKET_NAME to switch StoredFile to any
# S3-compatible provider. Every file consumer goes through the storage API (.open()/.delete(),
# never .path/.url), so this is the only place that changes.
AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME", default="")
if AWS_STORAGE_BUCKET_NAME:
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": AWS_STORAGE_BUCKET_NAME,
            "access_key": env("AWS_ACCESS_KEY_ID", default=""),
            "secret_key": env("AWS_SECRET_ACCESS_KEY", default=""),
            "region_name": env("AWS_S3_REGION_NAME", default=None),
            # Only for non-AWS providers (R2, MinIO, B2); real S3 resolves it from region_name.
            "endpoint_url": env("AWS_S3_ENDPOINT_URL", default=None),
            # The bucket stays private: files are served through authenticated Django views.
            "default_acl": "private",
            "querystring_auth": False,
            # MinIO and some self-hosted servers need "path"; AWS and most providers want "virtual".
            "addressing_style": env("AWS_S3_ADDRESSING_STYLE", default="virtual"),
        },
    }

# Branding uploads are the main use of the generic upload endpoint, hence the small default.
MAX_UPLOAD_SIZE_MB = env.int("MAX_UPLOAD_SIZE_MB", default=2)
# Extra file extensions to accept beyond files/validation.py's allowlist (stored as
# application/octet-stream). Active-content types such as html/svg/js/exe stay blocked.
UPLOAD_EXTRA_EXTENSIONS = env.list("UPLOAD_EXTRA_EXTENSIONS", default=[])
# Much larger cap for restore uploads (backups/views.py RestoreJobUploadView); nginx's
# body-size limit for that route must be at least this.
BACKUP_UPLOAD_MAX_SIZE_MB = env.int("BACKUP_UPLOAD_MAX_SIZE_MB", default=5120)
# Archives stored on this server are encrypted with this key (core/crypto.py server_key()):
# base64 of 32 random bytes, e.g.
# `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`.
# Unset derives one from SECRET_KEY. Downloaded backups use the admin's passphrase instead.
BACKUP_ENCRYPTION_KEY = env("BACKUP_ENCRYPTION_KEY", default="")
BACKUP_PASSPHRASE_MIN_LENGTH = 12
# scrypt cost for passphrase-encrypted backups (n = 2**this, ~128MB/0.5s). Tests use a
# cheap cost; the parameters are stored in each file's header, so decryption is unaffected.
BACKUP_SCRYPT_LOG2_N = 14 if "test" in sys.argv else 17


# CORS
# https://github.com/adamchainz/django-cors-headers

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:3000"])
# Lets the browser send/receive the httpOnly refresh cookie on cross-origin fetches.
CORS_ALLOW_CREDENTIALS = True


# Django REST Framework / JWT auth
# https://www.django-rest-framework.org/  https://django-rest-framework-simplejwt.readthedocs.io/

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # JWTAuthentication plus the policy-acceptance gate (policies/authentication.py).
        "policies.authentication.PolicyEnforcingJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # BrowsableAPIRenderer only in DEBUG. Otherwise DRF would serve its HTML error page to a
    # browser navigating straight to an API URL (e.g. an auth-gated file link).
    "DEFAULT_RENDERER_CLASSES": (
        ["rest_framework.renderers.JSONRenderer", "rest_framework.renderers.BrowsableAPIRenderer"]
        if DEBUG
        else ["rest_framework.renderers.JSONRenderer"]
    ),
    # The "auth" scope is opted into by LoginView/RegisterView/OrganizationCreateView for a
    # much stricter rate. RefreshView gets a looser "auth_refresh" scope because the SPA
    # calls it on every page load.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON_RATE", default="60/min"),
        "user": env("THROTTLE_USER_RATE", default="300/min"),
        "auth": env("THROTTLE_AUTH_RATE", default="10/min"),
        "auth_refresh": env("THROTTLE_AUTH_REFRESH_RATE", default="60/min"),
        "backup_download": env("THROTTLE_BACKUP_DOWNLOAD_RATE", default="10/hour"),
    },
    # Exactly one trusted proxy (nginx) overwrites X-Forwarded-For with the real peer
    # address. Without this, throttles key on the whole client-supplied header, which a
    # client can vary per request to dodge the "auth" scope's brute-force protection.
    "NUM_PROXIES": 1,
}

# Throttle counters are cache-backed and persist across tests, so the many logins the test
# helpers perform would trip the "auth" scope. Login/Register/Refresh set their own
# ScopedRateThrottle, which ignores DEFAULT_THROTTLE_CLASSES, so the scope rates must be
# cleared too (a rate of None turns a scope off).
if "test" in sys.argv:
    REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] = []
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["auth"] = None
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["auth_refresh"] = None
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["backup_download"] = None

SPECTACULAR_SETTINGS = {
    "TITLE": "Athar API",
    "DESCRIPTION": "Athar backend API - see docs/VISION.md for the product spec.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=env.int("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", default=15)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=env.int("JWT_REFRESH_TOKEN_LIFETIME_DAYS", default=7)
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "SIGNING_KEY": env("JWT_SIGNING_KEY", default="") or SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# The refresh token only ever travels as this httpOnly cookie, never in a JSON body.
JWT_REFRESH_COOKIE_NAME = env("JWT_REFRESH_COOKIE_NAME", default="refresh_token")
# Replaying an already-rotated refresh token is treated as theft and revokes the user's sessions,
# unless it happens within this many seconds of the rotation (two tabs refreshing at once).
JWT_REFRESH_REUSE_GRACE_SECONDS = env.int("JWT_REFRESH_REUSE_GRACE_SECONDS", default=10)
# Deliberately "/", not scoped to /api/v1/auth/: the Next.js proxy (proxy.ts) must see
# this cookie on every page route to decide whether to redirect to /login.
JWT_REFRESH_COOKIE_PATH = "/"
JWT_REFRESH_COOKIE_SECURE = env.bool("JWT_REFRESH_COOKIE_SECURE", default=not DEBUG)
JWT_REFRESH_COOKIE_SAMESITE = env("JWT_REFRESH_COOKIE_SAMESITE", default="Lax")
JWT_REFRESH_COOKIE_DOMAIN = env("JWT_REFRESH_COOKIE_DOMAIN", default="") or None

ENABLE_REGISTRATION = env.bool("ENABLE_REGISTRATION", default=True)
# Gates only creating a brand-new organization (organization.views.OrganizationCreateView);
# ENABLE_REGISTRATION gates joining an existing org by invitation code.
ENABLE_ORGANIZATION_REGISTRATION = env.bool("ENABLE_ORGANIZATION_REGISTRATION", default=True)
# Celery: backups.tasks.generate_org_backup on demand, plus the periodic jobs below.
# config.celery's `namespace="CELERY"` maps CELERY_BROKER_URL to Celery's `broker_url`.

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://redis:6379/0")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=CELERY_BROKER_URL)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
# Tests run tasks inline (no Redis/worker in CI), gated like the throttle override above.
CELERY_TASK_ALWAYS_EAGER = "test" in sys.argv
CELERY_TASK_EAGER_PROPAGATES = True

# Run by the `celery-beat` service. A plain in-code schedule, since these are a few fixed
# jobs. Hourly comfortably beats StoredFile's 24h grace period
# (files/services.py's UNCONFIRMED_FILE_GRACE_PERIOD).
CELERY_BEAT_SCHEDULE = {
    "delete-unconfirmed-files": {
        "task": "files.tasks.delete_unconfirmed_files",
        "schedule": 3600.0,
    },
    "scrub-old-audit-request-metadata": {
        "task": "audit.tasks.scrub_old_request_metadata",
        "schedule": 86400.0,
    },
}
# How long audit entries keep the requester's IP and user agent before
# audit.tasks.scrub_old_request_metadata clears them (the entry itself is kept).
AUDIT_IP_RETENTION_DAYS = env.int("AUDIT_IP_RETENTION_DAYS", default=90)


# Email

# Outgoing email (password reset links today) over plain SMTP, so any provider works
# (Resend: EMAIL_HOST=smtp.resend.com, EMAIL_HOST_USER=resend, EMAIL_HOST_PASSWORD=<API key>).
# Unset EMAIL_HOST turns email off: EMAIL_ENABLED is False, the UI hides "send by email",
# and anything sent is printed to the console instead. Read into lowercase locals because
# Django 6.1 refuses the old uppercase EMAIL_HOST/... settings alongside MAILERS.
_email_host = env("EMAIL_HOST", default="")
EMAIL_ENABLED = bool(_email_host)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Athar <noreply@localhost>")

MAILERS = {
    "default": (
        {
            "BACKEND": "django.core.mail.backends.smtp.EmailBackend",
            "OPTIONS": {
                "host": _email_host,
                "port": env.int("EMAIL_PORT", default=587),
                "username": env("EMAIL_HOST_USER", default=""),
                "password": env("EMAIL_HOST_PASSWORD", default=""),
                "use_tls": env.bool("EMAIL_USE_TLS", default=True),
                "use_ssl": env.bool("EMAIL_USE_SSL", default=False),
                "timeout": env.int("EMAIL_TIMEOUT", default=10),
            },
        }
        if EMAIL_ENABLED
        else {"BACKEND": "django.core.mail.backends.console.EmailBackend"}
    ),
}


# Logging and error tracking
LOG_LEVEL = env("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"standard": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "standard"}},
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    # Security events (e.g. refresh-token reuse) are logged here at ERROR so error tracking
    # alerts on them.
    "loggers": {"athar.security": {"level": "ERROR"}},
}

# Opt-in: errors (and ERROR-level logs, including athar.security) are sent to Sentry only when a DSN
# is set. No request bodies, cookies, auth headers or user identity are attached.
SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=env("SENTRY_ENVIRONMENT", default="") or ("development" if DEBUG else "production"),
        release=env("SENTRY_RELEASE", default=None),
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0),
    )
