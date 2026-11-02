"""Run the deployment script's actual Python cleanup against isolated releases."""
import contextlib
import io
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch


class ReleaseCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.releases = self.base / "releases"
        self.releases.mkdir()
        for index in range(6):
            directory = self.releases / f"r{index}"
            directory.mkdir()
            (directory / "file").write_text("fixture")
            os.utime(directory, (100 + index, 100 + index))
        source = (Path(__file__).resolve().parents[1] / "deploy.sh").read_text()
        self.code = source.rsplit("python3 - <<'PY'\n", 1)[1].split("\nPY", 1)[0]
        self.code = self.code.replace("Path('/srv/webank')", f"Path({str(self.base)!r})")
        original_resolve = Path.resolve

        def resolve(path, *args, **kwargs):
            if path == self.base / "current":
                return self.releases / "r0"
            return original_resolve(path, *args, **kwargs)

        self.resolve = patch.object(Path, "resolve", resolve)

    def run_cleanup(self):
        warnings = io.StringIO()
        with self.resolve, contextlib.redirect_stderr(warnings):
            exec(compile(self.code, "deploy-cleanup", "exec"), {})
        return warnings.getvalue()

    def test_permission_failure_warns_and_continues_cleaning_other_old_releases(self):
        original_remove = shutil.rmtree

        def remove(path, *args, **kwargs):
            if path == self.releases / "r2":
                raise PermissionError("root-owned setup-vps.sh")
            return original_remove(path, *args, **kwargs)

        with patch.object(shutil, "rmtree", remove):
            warnings = self.run_cleanup()
        self.assertIn("WARNING", warnings)
        self.assertIn("root-owned setup-vps.sh", warnings)
        self.assertTrue((self.releases / "r2").is_dir())
        self.assertFalse((self.releases / "r1").exists())
        self.assertTrue((self.releases / "r0").is_dir())

    def test_retains_latest_three_and_current_even_when_current_is_older(self):
        self.assertEqual(self.run_cleanup(), "")
        self.assertEqual({p.name for p in self.releases.iterdir()}, {"r0", "r3", "r4", "r5"})

    def test_unreadable_release_directory_warns_without_failing_completed_deployment(self):
        original_iterdir = Path.iterdir

        def iterdir(path):
            if path == self.releases:
                raise PermissionError("cannot list old releases")
            return original_iterdir(path)

        with patch.object(Path, "iterdir", iterdir):
            warnings = self.run_cleanup()
        self.assertIn("WARNING", warnings)
        self.assertIn("cannot list old releases", warnings)


if __name__ == "__main__":
    unittest.main()
