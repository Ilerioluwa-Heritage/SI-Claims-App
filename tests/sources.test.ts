import { describe, expect, it } from 'vitest';
import { KEPT_SOURCES, MONTHLY_SOURCES, SOURCE_NAMES, missingSources } from '../src/core/index.ts';

describe('the files a run needs', () => {
  it('lists them all when nothing is there: three monthly, two kept', () => {
    expect(missingSources({}).map((s) => SOURCE_NAMES[s])).toEqual([
      'Daily session register',
      'Debrief form',
      "Class attendance (lecturers' records)",
      'List of SI Leaders and their levels',
      'Blank HRM-05 claim form',
    ]);
    expect([MONTHLY_SOURCES.length, KEPT_SOURCES.length]).toEqual([3, 2]);
  });

  it('names the one still missing', () => {
    expect(missingSources({ register: 'file', classAttendance: 'file', levels: 'kept', claimForm: 'kept' })).toEqual(['debrief']);
  });

  it('is empty once the month is uploaded and the kept files are there', () => {
    expect(missingSources({ register: 'file', debrief: 'file', classAttendance: 'file', levels: 'kept', claimForm: 'kept' })).toEqual([]);
  });
});
