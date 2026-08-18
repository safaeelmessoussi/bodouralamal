[Documentation](README.md) › **SRS Proposal — Revision 76**

# SRS Proposal — Revision 76

**List sorting, and manual reordering, as contracts.**

**Status:** drafted 2026-08-18 on the Document Owner's approval of the
architectural direction (*"TABLE SORTING → SERVER-SIDE · MANUAL ORDERING → NEW
REORDER CONTRACT"*). **Not applied** — `docs/SRS.md` is immutable to the
implementer; this is the text to approve, and it is what the implementation
follows.

---

## 1 · What the SRS says today

**BR-19 and §2.2 fix the ordering of reference data**: `display_order` first, then
the natively `ar-x-icu` collated name, with no per-query `COLLATE` (§20 rule 13).
Every list service implements exactly that, and **no endpoint accepts a sort
parameter of any kind**.

**TD-10 fixes the list envelope**: `?page=1&page_size=25`, default 25, max 100,
`{ data, meta: { page, page_size, total } }`. It says nothing about ordering.

**§7 defines `display_order` as a nullable `Int`** on `Branch`, `Category`,
`Level`, `Subject`, `AdministrativeGroup` and `TeachingGroup`. It is **written
only as a field on create/update** — there is no reorder operation anywhere.

## 2 · What is missing

1. **A sort parameter.** TD-10 has no notion of one, so a sortable table header
   has nothing to call.
2. **A reorder operation.** `display_order` can be *set per row*, which cannot
   express *"move this row to position 3"* without the client computing every
   other row's number and sending N writes — racy, and able to produce duplicate
   or gapped values that BR-19's ordering then resolves arbitrarily.
3. **A statement of what `display_order` means when NULL**, which the reorder
   contract has to settle.

## 3 · The proposed revision

> **Revision 76 (Document Owner decision — list sorting and manual reordering,
> 2026-08-18):** **(1) TD-10 gains an optional sort.** Every paginated or listed
> collection accepts **`?sort_by=<field>&sort_dir=asc|desc`**, snake_case like
> `page_size` beside it. **`sort_by` names a FIELD IN THE CONTRACT, never a
> database column**: each endpoint declares an **explicit allow-list** mapping a
> public name to its own ordering expression, and a name outside that list is
> **`400 VALIDATION_FAILED`** — never ignored, and never passed through to the
> query. `sort_dir` accepts exactly `asc` and `desc`. **Sorting is performed by
> the database, never by the client**: a client sorting a page of a paginated
> collection would order that page and misreport it as the collection's order.
> **(2) Absent parameters preserve BR-19 exactly.** The existing
> `display_order` → collated-name order remains the default for every collection,
> and is what a caller receives when it asks for nothing — this revision adds a
> capability and changes no default. **(3) Every resolved order ends in a
> deterministic tiebreaker** (`id`), because TD-10's pagination is offset-based
> and two rows sharing a sort value may otherwise appear on two pages or on
> neither. **(4) A reorder contract joins TD-3:**
> **`PATCH /admin/{resource}/order`** with body **`{ ids: [...] }`** — **the
> sequence itself, not a per-row number**. The server assigns `display_order`
> from the sequence's positions, so **duplicate and gapped values are
> structurally impossible** rather than validated against. The request is refused
> unless `ids` is **exactly the live set** of that resource in the caller's scope
> — no duplicates, none missing, none foreign (`VALIDATION_FAILED`, naming which)
> — because a partial sequence cannot say where the omitted rows belong. It is
> applied in **one transaction** and returns the resulting order. **(5) The
> reorder authority is the resource's existing write authority**, and TD-2 gains
> **no row**: whoever may edit a Branch may reorder Branches. **(6) `display_order`
> semantics are settled: after any reorder a collection's values are
> `1..n`, contiguous and unique.** NULL remains valid for a row that has never
> been ordered and continues to sort last (`nulls: 'last'`, as today). **(7) Six
> entities carry `display_order` and FIVE are manually orderable** — `Branch`,
> `Category`, `Subject`, `Level`, `AdministrativeGroup`. **`TeachingGroup` is
> deliberately excluded**: it carries the column and no interface has ever set
> it, so ordering circles is not a decision anybody takes today, and adding the
> gesture would invent a workflow rather than expose one. **(8) §14.2 gains the
> interaction rules.** A sortable column's header is a **button** whose first
> press sorts ascending, second descending, third ascending again, with the
> current direction shown; the actions column is never sortable. The **`الترتيب`
> column is removed from every table** — a persisted ordering is expressed by
> **dragging a row**, not by typing a number — while the underlying field
> stays. **Drag is available only while the table is in its canonical order**:
> under any temporary column sort the visible sequence is not the business one,
> so dropping a row into it would persist a position the reader never intended.
> The table says which state it is in rather than failing silently.

## 4 · What this costs

| | |
|---|---|
| **Schema change** | **None.** `display_order` already exists on all six. |
| **New entities** | **None.** |
| **New endpoints** | Five, one per orderable resource, all the same shape. |
| **TD-2 rows** | **None** — reorder inherits the resource's write authority. |
| **Default behaviour** | **Unchanged.** BR-19 remains the answer to an unparameterised list. |
| **Injection surface** | **None added**: `sort_by` is an allow-listed contract name, refused if unknown. |

## 5 · What the Owner is being asked to approve

1. `sort_by` / `sort_dir` on list contracts, allow-listed per endpoint.
2. `PATCH /admin/{resource}/order` taking the **sequence**, refused unless it is
   the exact live set.
3. `display_order` becoming **contiguous `1..n`** after a reorder.
4. **Five** orderable resources; `TeachingGroup` excluded.
5. §14.2's interaction rules, including **drag only in canonical order**.

## 6 · If this is not approved

Nothing is half-built: without (1) the tables keep BR-19's order and no header is
a button; without (4) the `الترتيب` column stays and ordering continues through
the edit form.
