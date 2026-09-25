# Documentation — منصة بذور الأمل

Two kinds of document: the **contract** ([`SRS.md`](SRS.md) — normative, immutable to agents; its dated decisions in [`archive/SRS-revisions.md`](archive/SRS-revisions.md)) and the **handbook** (everything below — current facts, rewritten in place, no history). Open work: [`TASKS.md`](TASKS.md). Ledger: [`CHANGES.log`](CHANGES.log). Visual rulebook: [`../design.mmd`](../design.mmd). Agent entry: [`../CLAUDE.md`](../CLAUDE.md).

## Reading path

| Time | Read |
|---|---|
| 10 min | [purpose-and-context](overview/purpose-and-context.md) · [users-and-roles](overview/users-and-roles.md) |
| 1 h | [architecture/README](architecture/README.md) · [system-overview](architecture/system-overview.md) · [identity-and-access](architecture/identity-and-access.md) |
| Before code | [getting-started](development/getting-started.md) · [conventions](development/conventions.md) · [engineering-constitution](development/engineering-constitution.md) · [ux-architecture](development/ux-architecture.md) (any UI work) · [documentation-policy](development/documentation-policy.md) · [engineering-efficiency](development/engineering-efficiency.md) |

## Sections

| Section | Pages |
|---|---|
| **overview/** | [purpose-and-context](overview/purpose-and-context.md) · [users-and-roles](overview/users-and-roles.md) · [business-processes](overview/business-processes.md) · [user-journeys](overview/user-journeys.md) · [scope-and-roadmap](overview/scope-and-roadmap.md) · [glossary](overview/glossary.md) |
| **architecture/** | [system-overview](architecture/system-overview.md) · [backend](architecture/backend.md) · [frontend](architecture/frontend.md) · [database](architecture/database.md) · [api](architecture/api.md) · [identity-and-access](architecture/identity-and-access.md) · [security](architecture/security.md) · [storage](architecture/storage.md) · [background-jobs](architecture/background-jobs.md) · [calendar-and-hijri](architecture/calendar-and-hijri.md) · [design-system](architecture/design-system.md) · [internationalization](architecture/internationalization.md) · [performance-and-scale](architecture/performance-and-scale.md) |
| **development/** | [getting-started](development/getting-started.md) · [conventions](development/conventions.md) · [engineering-constitution](development/engineering-constitution.md) · [engineering-efficiency](development/engineering-efficiency.md) · [documentation-policy](development/documentation-policy.md) · [ux-architecture](development/ux-architecture.md) · [testing](development/testing.md) · [qa-inventory](development/qa-inventory.md) · [ci-cd](development/ci-cd.md) · [teaching-authority](development/teaching-authority.md) · [class-delivery](development/class-delivery.md) · [online-classroom](development/online-classroom.md) · [online-class-provider](development/online-class-provider.md) · [quran-progress](development/quran-progress.md) · [account-and-membership](development/account-and-membership.md) · [person-identity](development/person-identity.md) · [email-lock-keying](development/email-lock-keying.md) · [personal-data-map](development/personal-data-map.md) |
| **operations/** | [environments](operations/environments.md) · [configuration](operations/configuration.md) · [deployment](operations/deployment.md) · [deployment-readiness](operations/deployment-readiness.md) · [provider-acceptance](operations/provider-acceptance.md) · [recovery](operations/recovery.md) · [resilience](operations/resilience.md) · [observability](operations/observability.md) · [runbooks](operations/runbooks.md) |
| **reference/** | [api-endpoints](reference/api-endpoints.md) · [error-codes](reference/error-codes.md) · [business-rules](reference/business-rules.md) · [technical-design](reference/technical-design.md) · [decision-log](reference/decision-log.md) — generated: [`openapi.json`](openapi.json) (`backend/scripts/generate-openapi.ts`; never hand-edit) |
| **compliance/** | [personal-data-audit](compliance/personal-data-audit.md) · [cndp-filing-and-privacy-notice](compliance/cndp-filing-and-privacy-notice.md) · [data-collection-decision](compliance/data-collection-decision.md) · [r62-design-decisions](compliance/r62-design-decisions.md) |
| **archive/** | provenance only, never loaded by default: SRS ledger, closed TASKS/CHANGES, dated audits, the 2026-07-29 pre-restructure tree |

## Conventions

- A page states current facts; history is a one-line «since R<n>» at most. Cite the SRS by clause (§, BR-x, TD-x); never restate it.
- One rule lives in one place; other pages link to it. Links are relative; `bash scripts/ci/check-doc-links.sh` guards them.
- Compact Markdown: tables and bullets, no narrative. Update affected pages in the same commit as the code (§16.4).
