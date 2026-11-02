// The files every run needs. All three must be uploaded each time; a run
// doesn't start with any missing, and nothing is read straight from Google
// Sheets (SI Administrator, 2 Nov 2026).

export const SOURCES = ['register', 'debrief', 'classAttendance'] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_NAMES: Record<Source, string> = {
  register: 'Daily session register',
  debrief: 'Debrief form',
  classAttendance: "Class attendance (lecturers' records)",
};

/** The sources not uploaded yet, in the order above. Empty means the run can go ahead. */
export function missingSources(uploaded: Partial<Record<Source, unknown>>): Source[] {
  return SOURCES.filter((s) => uploaded[s] == null);
}
