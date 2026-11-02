// The files the app works from (SI Administrator, 2 and 3 Nov 2026).
//
// Every month: the daily register, the debrief and the lecturers' class
// attendance. A run doesn't start with any of them missing, and nothing is
// read straight from Google Sheets.
//
// Kept: the list of SI Leaders and their levels, and the blank HRM-05 claim
// form. Each is uploaded once and kept by the app until it's removed and a
// newer version uploaded. The claim form is used exactly as uploaded.

export const MONTHLY_SOURCES = ['register', 'debrief', 'classAttendance'] as const;
export const KEPT_SOURCES = ['levels', 'claimForm'] as const;
export type Source = (typeof MONTHLY_SOURCES)[number] | (typeof KEPT_SOURCES)[number];

export const SOURCE_NAMES: Record<Source, string> = {
  register: 'Daily session register',
  debrief: 'Debrief form',
  classAttendance: "Class attendance (lecturers' records)",
  levels: 'List of SI Leaders and their levels',
  claimForm: 'Blank HRM-05 claim form',
};

/** The sources not uploaded yet, monthly ones first. Empty means the run can go ahead. */
export function missingSources(uploaded: Partial<Record<Source, unknown>>): Source[] {
  return [...MONTHLY_SOURCES, ...KEPT_SOURCES].filter((s) => uploaded[s] == null);
}
