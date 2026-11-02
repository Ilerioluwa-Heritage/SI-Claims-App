import { describe, expect, it } from 'vitest';
import { SOURCE_NAMES, missingSources } from '../src/core/index.ts';

describe('the three files every run needs', () => {
  it('lists all three when nothing is uploaded', () => {
    expect(missingSources({}).map((s) => SOURCE_NAMES[s])).toEqual([
      'Daily session register',
      'Debrief form',
      "Class attendance (lecturers' records)",
    ]);
  });

  it('names the one still missing', () => {
    expect(missingSources({ register: 'file', classAttendance: 'file' })).toEqual(['debrief']);
  });

  it('is empty once all three are uploaded', () => {
    expect(missingSources({ register: 'file', debrief: 'file', classAttendance: 'file' })).toEqual([]);
  });
});
