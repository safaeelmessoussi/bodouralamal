/** The seven weekdays in the contract's vocabulary, Monday first — one list
 *  for the recurrence editor and the availability editor. */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];
