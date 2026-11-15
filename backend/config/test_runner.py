"""Test runner that keeps test file I/O out of the real media storage.

Tests upload files, generate backup archives and render thumbnails through
the default storage. Without this they wrote into the developer's real
MEDIA_ROOT (leaving thousands of orphan files behind, since the test database
that referenced them is thrown away) - or, with AWS_STORAGE_BUCKET_NAME set,
into the real S3 bucket.

The whole run gets a fresh local folder instead, deleted afterwards. It's
passed to `--parallel` worker processes through ATHAR_TEST_MEDIA_ROOT (read by
config/settings.py), since workers started with spawn/forkserver re-import the
settings rather than inheriting this process's overrides.
"""

import os
import shutil
import tempfile

from django.test.runner import DiscoverRunner
from django.test.utils import override_settings

TEST_MEDIA_ENV = "ATHAR_TEST_MEDIA_ROOT"


class IsolatedMediaTestRunner(DiscoverRunner):
    def setup_test_environment(self, **kwargs):
        self._media_root = tempfile.mkdtemp(prefix="athar-test-media-")
        os.environ[TEST_MEDIA_ENV] = self._media_root
        # override_settings (not a plain assignment) so Django's
        # setting_changed signal resets the already-built storage objects.
        self._media_override = override_settings(
            MEDIA_ROOT=self._media_root,
            STORAGES={
                "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            },
        )
        self._media_override.enable()
        super().setup_test_environment(**kwargs)

    def teardown_test_environment(self, **kwargs):
        super().teardown_test_environment(**kwargs)
        self._media_override.disable()
        os.environ.pop(TEST_MEDIA_ENV, None)
        shutil.rmtree(self._media_root, ignore_errors=True)
