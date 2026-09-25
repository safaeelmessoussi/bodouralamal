[Documentation](../README.md) › [Development](README.md) › **Engineering constitution**

# Engineering constitution

Laws every implementation satisfies. ⚖️ = normative in the SRS (pointer only) · ✳️ = stated here · 🤖 = a CI guard fails the build. Numbering is stable — other pages cite it.

## 0 · Mindset
| # | Law |
|---|---|
| 0.1 ✳️ | **Build systems, not pages.** A table, form, search, pagination, dialog, uploader, date picker, viewer, player is a platform capability whose first consumer is this page. Ask «does the platform have a table?», not «does this page need one?» |
| 0.2 ✳️ | **Every implementation enriches the platform.** Branch CRUD improves the CRUD framework; content improves document infrastructure; approvals improve the review workflow. The feature is the occasion, the capability the deliverable. |
| 0.3 ✳️ | **Ask what will reuse this.** «Nothing» is allowed only as a decision, never a default. |

## 1 · Architecture
| # | Law |
|---|---|
| 1.1 ⚖️ | **Backend is the source of truth.** Any business answer (name, cost, pass/fail, publishable identity, Hijri date — §20 rules 14, 21) is computed server-side; clients render verbatim and may compute presentation only. Client validation mirrors shared limits for feedback; the server is the authority. Test: would two clients disagree? → server. |
| 1.2 ⚖️ | **One authoritative home per concept** (§16.4) — in code, schema and docs. Duplicate found → delete a copy and link the survivor; never synchronise. |
| 1.3 ⚖️🤖 | **API-first, contract-governed.** `openapi.json` is generated, never edited; no endpoint the SRS does not list (§20 rule 16). `check-openapi-td3.sh`. |
| 1.4 ⚖️ | **Layering enforced:** controllers HTTP only · services own logic, TD-4 transactions, TD-1 machines · repositories are the sole data access (§16.2). → [conventions § layering](conventions.md#layering) |
| 1.5 ✳️ | **The adapter is the only seam.** Components never fetch or see raw payloads; adapter types are the response shape. A mock adapter is a placeholder behind the seam, never a licence to invent a contract. |

## 2 · Reuse — generic first
| # | Law |
|---|---|
| 2.1 ✳️ | **One component per concept, never per entity.** `DataTable`, `EntityForm` configured — never `StudentTable`, `TeacherForm`. Same for dialogs, search, cards, empty states, pagination (§14.3). |
| 2.2 ✳️ | **Every CRUD screen feels identical**: toolbar, buttons, wording, search, filters, dialogs, pagination, states, keyboard. «Almost the same» is worse than different. |
| 2.3 ✳️ | **Configure, do not hardcode.** Icons, labels, columns, filters, actions, colours, permissions, copy are configuration; copy is i18n keys (§16.2). Test: a second entity means new configuration, not an edited component. |
| 2.4 ✳️ | **Zero visual duplication.** 95 % identical screens share components, not just CSS. |
| 2.5 ✳️ | **Variants, not new components** (`<Button variant="danger">`, `<Dialog wide>`). A third boolean + a special case = redraw the concept. |
| 2.6 ✳️ | **Before creating a component:** another screen will need it → shared registry with a variant API; no → feature component beside its feature; unsure → feature component, promoted by **moving** on the second consumer. No speculative generality. |
| 2.7 ✳️ | **Extract on the second use.** If generalising is harder than copying, that is a design problem, not a reason to copy. |
| 2.8 ✳️ | **Never modify a copy.** Improve the original to fit both. |

## 3 · Atomic composition
| # | Law |
|---|---|
| 3.1 ✳️ | Page → Section → Card → List → DataTable → Cell → Text. A page reads as named parts; more than a screenful of JSX means unnamed parts. |
| 3.2 ✳️ | **One responsibility.** A `DatePicker` picks dates — no validation, formatting, fetching or saving. Fetch/decide in the page; render in the component. |

## 4 · Frontend
| # | Law |
|---|---|
| 4.1 ⚖️ | One CRUD layout: title · actions · filters · paginated table · row actions · all states (§14.2, §14.3). |
| 4.2 ⚖️ | Every page: loading skeleton · empty · error + request id · no-permission · no-results (distinct from empty) · offline/retry (§14.4). |
| 4.3 ✳️ | Forms are assembled from the shared field components (`components/ui/field.tsx`) inside `FormDialog`; never hand-built inputs. |
| 4.4 ⚖️ | Navigation is §14.1 exactly, held as data in the portal registries; a drill-down is a parameter, not a node. |

## 5 · Design system
| # | Law |
|---|---|
| 5.1 ⚖️🤖 | Semantic tokens only — no raw colour, size, radius, duration. `check-design-tokens.sh`. → [design-system](../architecture/design-system.md), [`design.mmd`](../../design.mmd) |
| 5.2 ⚖️ | Import order is the cascade; equal-specificity states in ascending priority, commented. |
| 5.3 ✳️ | Consistency beats local optimisation: an improvement worth having goes into the shared component; a gap in the system is filled, not worked around. |
| 5.4 ✳️ | Colour never carries meaning alone; a sub-threshold brand colour is a recorded, measured decision. |

## 6 · Backend
| # | Law |
|---|---|
| 6.1 ⚖️🤖 | Repositories are the only data access; soft-delete filtering uniform (§16.2). `check-prisma-mass-write.sh` |
| 6.2 ⚖️ | Validation limits live once, in the Zod boundary, shared with the client (TD-9). |
| 6.3 ⚖️ | Transactions and state machines belong to services; TD-4 boundaries verbatim incl. same-transaction job enqueue. |
| 6.4 ⚖️🤖 | Responses are allow-list DTOs, never ORM entities (§16.2 R38). `check-contract-dto.sh`. Adapters adapt, never repair a contract — a repair is a defect report. |
| 6.5 ✳️ | **Recorded exception to 2.1:** no generic CRUD services — they would bypass TD-1/TD-2/TD-4. Reuse the mechanism (locking helper, pagination, scope policies, audit and job repositories); keep each business operation explicit. |

## 7 · Documentation
| # | Law |
|---|---|
| 7.1 ⚖️ | Docs are part of Done, same commit (§16.4). → [documentation-policy](documentation-policy.md) |
| 7.2 ⚖️ | Discovered knowledge is debt from the moment of discovery. Close every task with: what did I learn · what pattern emerged · what pitfall · what will the next developer thank me for. |
| 7.3 ⚖️ | Record what was rejected, and why, where the decision lives. |

## 8 · Process (in this order)
1 read the relevant docs → 2 does it change the SRS? (revision = stop and report, §20 rule 20) → 3 reuse an existing component? improve it if it almost fits → 4 extract a generic one? (second consumer = now) → 5 an existing API already does this? → 6 name the new reusable patterns → 7 implement → 8 refactor at the second consumer → 9 update docs → 10 verify no duplicated code **or behaviour** → 11 report in six sections. Steps 2 and 5 are the ones skipped most and cost most.

## 9 · Definition of Done (all, not most)
Backend + frontend incl. every §14.4 state, or the blocker reported · reusable parts extracted, duplication removed · no business value in a client · tests assert the property · tokens only · accessibility (labels, roles, focus, keyboard, colour not alone) · 360 px and RTL verified · docs updated in the same commit, links checked, `CHANGES.log` appended, `TASKS.md` row removed · SRS untouched unless the Owner revised it · exceptions stated in the report. Reporting done with any of these outstanding is reporting falsely.

## 10 · When a law blocks you
Never violate silently, never route around (copying to avoid improving). State the conflict, propose the resolution, and stop and ask if the SRS must change. §6.5 is the worked example.

**Related:** [conventions](conventions.md) · [documentation-policy](documentation-policy.md) · [testing](testing.md) · [architecture](../architecture/README.md) · [technical-design](../reference/technical-design.md)
