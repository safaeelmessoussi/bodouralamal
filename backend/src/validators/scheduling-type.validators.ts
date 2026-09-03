import { z } from 'zod';

import { version } from './common.js';

/**
 * The scheduling-type catalogue boundary (R110, NEW H).
 *
 * **`structural_kind` is accepted on CREATE and refused on UPDATE**, and
 * `.strict()` refuses it rather than dropping it. It decides which entity the
 * type routes to, so changing it would re-point every activity already recorded
 * against the row at a model that cannot represent them — the same reasoning
 * §4.4 applies to a course schedule's subject and target and §4.6 to an exam's
 * level. A type that routes somewhere else is a new type.
 *
 * **`display_order` is absent from both**, deliberately. R76 settled that
 * ordering is expressed as a whole sequence through `PATCH .../order`; accepting
 * a position here as well would be a second ordering mechanism, and the two
 * would disagree the first time they were used together.
 */

/** Shorter than `entityName`: these are picker labels — «حصة دراسية», «عطلة» —
 *  and the column is `VARCHAR(60)`. */
const typeName = z.string().trim().min(1).max(60);

/**
 * The three entities a type can be delivered by (R56, stored by R110).
 *
 * Named here as well as in the database enum so a bad value is a field-level
 * `400` rather than a constraint violation surfacing as a 500 — the standing
 * division everywhere on this boundary.
 */
export const structuralKind = z.enum(['class', 'activity', 'exam']);

/**
 * **R123 — the three states, and why `disabled` is one of them.**
 *
 * `disabled` is what a عطلة and a حفل are: no sheet exists, and the server
 * refuses to read, mark or configure attendance for an occurrence of that type
 * rather than the client merely hiding a button.
 */
export const attendanceMode = z.enum(['disabled', 'optional', 'required']);

export const createSchedulingTypeSchema = z
  .object({
    name: typeName,
    structural_kind: structuralKind,
    /**
     * **Required, and deliberately not defaulted** (R123). What attendance
     * means for a type is a decision about what the type IS, and a default
     * would let one be created without anybody making it — which is precisely
     * how a catalogue ends up with a setting nobody chose. اختبار takes
     * attendance, محاضرة may, عطلة never does, and nothing about any of those
     * words says so.
     */
    attendance_mode: attendanceMode,
  })
  .strict();

export const updateSchedulingTypeSchema = z
  .object({
    version,
    name: typeName.optional(),
    attendance_mode: attendanceMode.optional(),
  })
  .strict();
