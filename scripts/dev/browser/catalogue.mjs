/**
 * **What the scheduling types are CALLED today, asked of the platform itself.**
 *
 * The catalogue is reference data a Super Admin edits (SRS R110): she may
 * rename, reorder, retire or add a type at any time, and nothing may break when
 * she does (Owner, 2026-09-21 — SRS Revision 168 §4). On that day she renamed
 * the first class type and five harnesses that had TYPED its old name went
 * blind, reporting failures in a product that was correct.
 *
 * So no harness types a name. It asks for the live catalogue through the same
 * route the screens use, and addresses a type by what it IS — its structural
 * kind, its attendance mode, its position — never by what it is called.
 *
 * Runs in the page, as the signed-in caller (the refresh cookie the harness
 * already set). NEVER put a backtick in a comment inside the page code.
 */
export async function readCatalogue(evaluate) {
  const raw = await evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    if (!r.ok) return JSON.stringify({ error: 'refresh ' + r.status });
    const { access_token } = await r.json();
    const res = await fetch('/api/v1/admin/scheduling-types', {
      headers: { Authorization: 'Bearer ' + access_token },
    });
    if (!res.ok) return JSON.stringify({ error: 'catalogue ' + res.status });
    return JSON.stringify({ rows: (await res.json()).data });
  })()`);
  const parsed = JSON.parse(raw ?? '{}');
  if (!Array.isArray(parsed.rows)) {
    throw new Error('the scheduling-type catalogue could not be read: ' + (parsed.error ?? raw));
  }
  const rows = [...parsed.rows].sort((a, b) => a.display_order - b.display_order);

  /** The first live type of a structural kind, optionally of one attendance mode. */
  const first = (kind, attendanceMode) => {
    const row = rows.find(
      (r) => r.structural_kind === kind && (attendanceMode === undefined || r.attendance_mode === attendanceMode),
    );
    return row ?? null;
  };
  return { rows, first, names: rows.map((r) => r.name) };
}
