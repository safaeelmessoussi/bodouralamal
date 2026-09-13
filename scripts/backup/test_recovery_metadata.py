import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("metadata", pathlib.Path(__file__).with_name("recovery-metadata.py"))
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)


class RecoveryMetadataTest(unittest.TestCase):
    def setUp(self):
        self.rows = [dict(id="a" * 64, hostname="wanted", tags=["bodour"], time="2026-01-01T00:00:00Z"),
                     dict(id="b" * 64, hostname="other", tags=["bodour"], time="2026-02-01T00:00:00Z")]
        self.manifest = "\n".join(["format=bodour-recovery-point-v1", "compose_project=wanted",
                                   "volumes=db-data,minio-data", "database_image_id=db", "storage_image_id=s3",
                                   "repository_id=repo", "git_commit=" + "c" * 40])

    def test_latest_is_project_scoped(self):
        self.assertEqual(metadata.select_snapshot(self.rows, "wanted", "latest"), "a" * 64)

    def test_explicit_other_project_refused(self):
        with self.assertRaises(ValueError):
            metadata.select_snapshot(self.rows, "wanted", "b" * 64)

    def test_missing_or_unpinned_snapshot_refused(self):
        for requested in ["bad", "a" * 8, "c" * 64]:
            with self.assertRaises(ValueError):
                metadata.select_snapshot(self.rows, "wanted", requested)

    def test_tag_required(self):
        self.rows[0]["tags"] = []
        with self.assertRaises(ValueError):
            metadata.select_snapshot(self.rows, "wanted", "latest")

    def test_manifest_matches_exact_data_images_and_repo(self):
        metadata.validate_manifest(self.manifest, "wanted", "minio-data,db-data", "db", "s3", "repo")
        for args in [("other", "db-data,minio-data", "db", "s3", "repo"),
                     ("wanted", "db-data", "db", "s3", "repo"),
                     ("wanted", "db-data,minio-data", "db", "minio", "repo"),
                     ("wanted", "db-data,minio-data", "db", "s3", "other")]:
            with self.assertRaises(ValueError):
                metadata.validate_manifest(self.manifest, *args)

    def test_duplicate_and_legacy_manifest_refused(self):
        for text in [self.manifest + "\ncompose_project=wanted", self.manifest.replace("repository_id=repo", "old=1")]:
            with self.assertRaises(ValueError):
                metadata.validate_manifest(text, "wanted", "db-data,minio-data", "db", "s3", "repo")


if __name__ == "__main__":
    unittest.main()
