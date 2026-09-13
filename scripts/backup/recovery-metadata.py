"""Fail-closed parsing of restic metadata; never execute a recovered manifest."""
import datetime
import json
import re
import sys


def select_snapshot(rows, project, requested):
    if requested != "latest" and not re.fullmatch(r"[0-9a-f]{64}", requested):
        raise ValueError("use a full snapshot ID or project-scoped latest")
    matches = [row for row in rows if row.get("hostname") == project
               and "bodour" in row.get("tags", [])
               and (requested == "latest" or row.get("id") == requested)]
    if not matches:
        raise ValueError("no snapshot belongs to the requested source project")
    matches.sort(key=lambda row: (datetime.datetime.fromisoformat(row["time"].replace("Z", "+00:00")), row["id"]))
    selected = matches[-1]
    if not re.fullmatch(r"[0-9a-f]{64}", selected["id"]):
        raise ValueError("invalid snapshot identity")
    return selected["id"]


def validate_manifest(text, project, volumes, database_image, storage_image, repository_id):
    lines = text.splitlines()
    entries = [line.split("=", 1) for line in lines]
    if any(len(entry) != 2 for entry in entries) or len(dict(entries)) != len(entries):
        raise ValueError("invalid recovery manifest")
    manifest = dict(entries)
    if (manifest.get("format") != "bodour-recovery-point-v1"
            or manifest.get("compose_project") != project
            or set(manifest.get("volumes", "").split(",")) != set(volumes.split(","))
            or manifest.get("database_image_id") != database_image
            or manifest.get("storage_image_id") != storage_image
            or manifest.get("repository_id") != repository_id
            or not re.fullmatch(r"[0-9a-f]{40}", manifest.get("git_commit", ""))):
        raise ValueError("manifest project, volumes or exact data images differ")


if __name__ == "__main__":
    try:
        if sys.argv[1] == "select":
            print(select_snapshot(json.load(sys.stdin), *sys.argv[2:]))
        elif sys.argv[1] == "manifest":
            validate_manifest(sys.stdin.read(), *sys.argv[2:])
        elif sys.argv[1] == "created":
            rows = [json.loads(line) for line in sys.stdin if line.strip()]
            ids = [row["snapshot_id"] for row in rows if row.get("message_type") == "summary"]
            if len(ids) != 1 or not re.fullmatch(r"[0-9a-f]{64}", ids[0]):
                raise ValueError("backup did not return exactly one snapshot")
            print(ids[0])
        else:
            raise ValueError("unknown metadata operation")
    except (ValueError, KeyError, TypeError, IndexError, AttributeError):
        sys.exit("backup: invalid or mismatched recovery metadata; no target restore authorized")
