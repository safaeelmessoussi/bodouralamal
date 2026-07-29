# Documentation snapshot — 2026-07-29, pre-restructure

A byte-exact copy of every project document as it existed **immediately before** the
documentation was reorganised into the hierarchy now rooted at [`docs/README.md`](../../README.md).

| Field | Value |
|---|---|
| Taken at | 2026-07-29 |
| Git commit | `88c222a5ff6fe14ead242eae6bb9c816f1381ffc` |
| SRS revision at the time | **36.2** |
| Integrity | [`SHA256SUMS.txt`](SHA256SUMS.txt) |

## Why this exists

The restructure moved a large amount of prose between files. A snapshot makes the claim
*"nothing was lost"* **checkable** rather than asserted: any paragraph suspected of having
gone missing can be found here and traced to its new home.

It is a **historical record and is never updated.** It is not a second source of truth —
if it disagrees with the live documentation, the live documentation is correct and this
directory is simply older.

## Contents

| File | What it was |
|---|---|
| [`SRS.md`](SRS.md) | The specification at Revision 36.2 |
| [`TASKS.md`](TASKS.md) | The delivery checklist |
| [`CHANGES.log`](CHANGES.log) | The append-only build ledger |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Milestone build order |
| [`openapi.json`](openapi.json) | The generated API contract |
| [`README-root.md`](README-root.md) | The repository README (renamed to avoid shadowing this file) |
| [`CLAUDE.md`](CLAUDE.md), [`AGENTS.md`](AGENTS.md) | Agent working agreements |

## Verifying the snapshot

```bash
cd docs/archive/2026-07-29-pre-restructure && sha256sum -c SHA256SUMS.txt
```

## What happened to each file

**Nothing was deleted.** `SRS.md`, `TASKS.md`, `CHANGES.log` and `openapi.json` all remain
live at their original paths in [`docs/`](../../) and continue to be maintained. The SRS in
particular is **still the normative specification** — the new documentation explains and
navigates it, and never supersedes it.

The restructure added explanatory documents around those files; it moved none of them.
