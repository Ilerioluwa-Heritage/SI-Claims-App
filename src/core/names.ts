// Matching the names typed into the forms ("MANTSINA. NH", "Mojoe RR",
// "Rakgaledi") to the roster. A row is only matched when exactly one roster
// person fits; anything less certain is reported, never guessed.

export interface RosterPerson {
  surname: string;
  initials: string;
  /** Name as printed on the form, e.g. "MABUNDA YP". */
  formName: string;
  level: string;
  active: boolean;
  role: 'SIL' | 'Admin';
  aliases: string[];
  /**
   * From the levels list, for the control list's STUDENT NO: column only
   * (SI Administrator, 3 Nov 2026). Never put on a claim form or in the checks report.
   */
  studentNumber?: string;
}

/** 'spelling' means the surname was one letter off; the checks report lists these. */
export type MatchHow = 'exact' | 'alias' | 'spelling';

export type MatchResult =
  | { matched: true; person: RosterPerson; how: MatchHow; initialsChecked: boolean }
  | { matched: false; reason: string; candidates: RosterPerson[] };

/** Upper case, letters only, single spaces: "Mantsina. N.H" -> "MANTSINA N H". */
export function normaliseName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim();
}

/**
 * Splits a typed name into surname and initials. Short words (3 letters or
 * fewer) are read as initials, longer words as the surname, so both
 * "MANTSINA NH" and "N.H. Mantsina" give MANTSINA / NH.
 */
export function splitName(raw: string): { surname: string; initials: string } {
  const words = normaliseName(raw).split(' ').filter(Boolean);
  const surname = words.filter((w) => w.length > 3).join(' ');
  const initials = words.filter((w) => w.length <= 3).join('');
  if (!surname && words.length === 1) return { surname: words[0]!, initials: '' };
  return { surname, initials };
}

/** Number of single-letter edits between two words (Levenshtein distance). */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Surnames shorter than this must be spelt exactly; longer ones may be one letter off. */
const MIN_LENGTH_FOR_SPELLING_MATCH = 5;

export function matchName(raw: string, roster: RosterPerson[]): MatchResult {
  const typed = normaliseName(raw);
  if (!typed) return { matched: false, reason: 'name is blank', candidates: [] };

  const key = (s: string) => Object.values(splitName(s)).join(' ');
  const byAlias = roster.filter((p) => p.aliases.some((a) => key(a) === key(raw)));
  if (byAlias.length === 1) return { matched: true, person: byAlias[0]!, how: 'alias', initialsChecked: true };
  if (byAlias.length > 1) return { matched: false, reason: 'alias belongs to more than one person', candidates: byAlias };

  const { surname, initials } = splitName(raw);
  const initialsFit = (p: RosterPerson) => !initials || normaliseName(p.initials).replace(/ /g, '') === initials;
  const pick = (people: RosterPerson[], how: MatchHow): MatchResult | null => {
    const fitting = people.filter(initialsFit);
    if (fitting.length === 1) return { matched: true, person: fitting[0]!, how, initialsChecked: initials !== '' };
    if (fitting.length > 1) {
      const reason = how === 'spelling' ? 'close to more than one roster name' : `more than one ${surname} on the roster`;
      return { matched: false, reason, candidates: fitting };
    }
    if (people.length) {
      return { matched: false, reason: `initials "${initials}" don't match the roster`, candidates: people };
    }
    return null;
  };

  const sameSurname = roster.filter((p) => normaliseName(p.surname) === surname);
  const exact = pick(sameSurname, 'exact');
  if (exact) return exact;

  if (surname.length >= MIN_LENGTH_FOR_SPELLING_MATCH) {
    const close = roster.filter((p) => editDistance(normaliseName(p.surname), surname) === 1);
    const spelling = pick(close, 'spelling');
    if (spelling) return spelling;
  }
  return { matched: false, reason: 'not on the roster', candidates: [] };
}
