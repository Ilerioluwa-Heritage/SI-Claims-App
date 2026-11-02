// The register and the debrief must agree, but the register wins
// (SI Administrator, 3 Nov 2026):
//   - a session in the register with no debrief is still claimed, and is
//     listed on the side note (SI Leader and dates);
//   - a debrief with no session in the register is never claimed, but is
//     flagged: a session may be missing from the register, or may not.
// A debrief belongs to a register session if it's the same SI Leader, the same
// day, and starts within 30 minutes of it.

import type { DebriefRow } from './debrief.ts';
import { SAME_SESSION_MINUTES, type RegisterRow } from './register.ts';

export interface CrossCheck {
  /** Claimed register sessions with no debrief. Still claimed; they go on the side note. */
  notInDebrief: RegisterRow[];
  /** Debriefs with no session in the register. Never claimed; flagged. */
  notInRegister: DebriefRow[];
  /** Debriefs for a session the register leaves out, e.g. one marked cancelled. */
  forLeftOut: { register: RegisterRow; debrief: DebriefRow }[];
}

/** Pairs one SI Leader's register rows with their debriefs (both already matched to them). */
export function crossCheck(register: RegisterRow[], debrief: DebriefRow[]): CrossCheck {
  const unpaired = new Set(debrief);
  const result: CrossCheck = { notInDebrief: [], notInRegister: [], forLeftOut: [] };
  // Rows with a start time pair first, so a row with no time can't take a debrief another row fits better.
  const rows = register.filter((r) => r.date).sort((a, b) => Number(a.start === null) - Number(b.start === null));
  for (const r of rows) {
    const gap = (d: DebriefRow) => (r.start === null || d.start === null ? 0 : Math.abs(d.start - r.start));
    const fits = [...unpaired]
      .filter((d) => d.date === r.date && (r.start === null || (d.start !== null && gap(d) <= SAME_SESSION_MINUTES)))
      .sort((a, b) => gap(a) - gap(b));
    const match = fits[0];
    if (match) {
      unpaired.delete(match);
      if (!r.claimed && !r.problem) result.forLeftOut.push({ register: r, debrief: match });
    } else if (r.claimed) {
      result.notInDebrief.push(r);
    }
  }
  result.notInRegister = debrief.filter((d) => unpaired.has(d));
  return result;
}
