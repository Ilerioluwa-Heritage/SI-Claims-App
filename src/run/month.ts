// One month, start to finish: who worked, what each person claims, and the
// checks report. It works from what the readers produced and touches no
// files, so the website, the phone app and the tests all share it.

import { amountCents, formatHours, formatRand, parseRand } from '../core/money.ts';
import { matchName, normaliseName, splitName, type MatchResult, type RosterPerson } from '../core/names.ts';
import { buildSilClaim, formatDates, type ClaimResult, type NoteKind } from '../core/rules.ts';
import { LEVELS, type Level, type Settings } from '../core/settings.ts';
import { formatTime } from '../core/time.ts';
import type { ControlListRow } from '../out/control-list.ts';
import { crossCheck } from '../read/cross-check.ts';
import { levelOf, type DebriefRow } from '../read/debrief.ts';
import type { RegisterRow } from '../read/register.ts';
import { plainHeading } from '../read/values.ts';

/** One class from the lecturers' attendance records: which SI Leader attended, and when. */
export interface LecturerClass {
  /** Where it is in the lecturers' file, for the checks report. */
  where: string;
  name: string;
  /** "YYYY-MM-DD" */
  date: string;
  module: string;
  /** Lecture start, minutes since midnight. */
  start: number;
}

export interface MonthInputs {
  month: number;
  year: number;
  /** The whole register as read, with missing times already taken from the debrief. */
  register: RegisterRow[];
  debrief: DebriefRow[];
  classes: LecturerClass[];
  /** The list of SI Leaders and administrators with their levels (uploaded once). */
  roster: RosterPerson[];
}

/** The parts of the checks report, in the order they're shown. */
export const CHECK_SECTIONS = {
  unmatched: "Names that couldn't be matched (not claimed)",
  'register-problem': "Register rows that couldn't be read with certainty (not claimed)",
  'not-in-register': 'On the debrief but not in the register (not claimed; a session may be missing from the register)',
  'not-on-debrief': 'Side note: in the register but not on the debrief (claimed, because the register wins)',
  levels: 'Levels and rates',
  'left-out': 'Register rows left out by their colour',
  filled: 'Times taken from the debrief',
  names: 'Names: spelling matches, and people not on the SI list',
  cap: 'Capped at the monthly limit',
  midnight: 'Time moved onto the start to finish by 23H30',
  'data-allowance': 'How the data allowance was spread',
  forms: 'Lines combined to fit the form, and second forms',
  'form-text': 'Text wider than its box on the form (cut off on screen and paper; the full text is in the box)',
  classes: 'Class attendance records',
  admins: 'Administrators',
} as const;
export type CheckSection = keyof typeof CHECK_SECTIONS;

export interface Check {
  section: CheckSection;
  /** The person it's about, as printed on the form; null if no one could be matched. */
  person: string | null;
  message: string;
}

export interface PersonResult {
  person: RosterPerson;
  level: Level | null;
  /** Null if the level on the list isn't one the rates know. */
  rateCents: number | null;
  /** SI Leaders: their month by the rules. Administrators: null (claimed at a fixed number of hours). */
  claim: ClaimResult | null;
  totalMinutes: number;
  /** Null when there's no rate. */
  amountCents: number | null;
}

export interface MonthResult {
  /** Everyone with something to claim, alphabetical by surname. */
  people: PersonResult[];
  checks: Check[];
  /** The amounts that could be worked out, added up. */
  totalCents: number;
  /** False if anyone's amount couldn't be worked out (no rate); the checks say who. */
  complete: boolean;
}

const SECTION_FOR_NOTE: Record<NoteKind, CheckSection> = {
  'invalid-session': 'register-problem',
  'data-allowance': 'data-allowance',
  midnight: 'midnight',
  'duplicate-class': 'classes',
  cap: 'cap',
  combined: 'forms',
  'too-many-lines': 'forms',
};

/** A level of study as written on the list ("3rd", "Honours", "PGD(NQF8)", "Level 3 (Third Year)"); null if unknown. */
export function levelFromList(text: string, settings: Settings): Level | null {
  const key = plainHeading(text);
  if (!key) return null;
  const listed = Object.entries(settings.listLevels).find(([answer]) => plainHeading(answer) === key)?.[1];
  return LEVELS.find((l) => plainHeading(l) === key) ?? listed ?? levelOf(text, settings);
}

/** The people the month is matched against: the list of SI Leaders, plus the administrators from the settings. */
export function rosterWithAdmins(list: RosterPerson[], settings: Settings): RosterPerson[] {
  const admins = settings.admins.map((a): RosterPerson => ({ ...splitName(a.name), formName: a.name, level: a.level, active: true, role: 'Admin', aliases: [] }));
  return [...list, ...admins];
}

/** The control list's rows: everyone with something to claim. */
export function controlListRows(result: MonthResult): ControlListRow[] {
  return result.people.map((p) => ({
    surname: p.person.surname,
    initials: p.person.initials,
    studentNumber: p.person.studentNumber ?? '',
    level: p.level ?? p.person.level,
    minutes: p.totalMinutes,
    rateCents: p.rateCents,
  }));
}

export function runMonth(input: MonthInputs, settings: Settings): MonthResult {
  const checks: Check[] = [];
  const add = (section: CheckSection, person: string | null, message: string) => checks.push({ section, person, message });
  const prefix = `${input.year}-${String(input.month).padStart(2, '0')}-`;
  const inMonth = (date: string) => date.startsWith(prefix);
  const day = (date: string) => (date ? formatDates([date]) : 'no date');

  // Someone not on the list: their name and level come from their debriefs this month (SI Administrator, 3 Nov 2026).
  const roster = [...input.roster];
  const fromDebrief = new Map<RosterPerson, Set<string>>();
  for (const d of input.debrief) {
    if (!d.date || !inMonth(d.date) || !d.name) continue;
    const m = matchName(d.name, roster);
    if (m.matched) {
      fromDebrief.get(m.person)?.add(d.levelText);
      continue;
    }
    // Not on the list, or on it with other initials. Two people it could be: leave it for the checks.
    if (/more than one/.test(m.reason)) continue;
    const { surname, initials } = splitName(d.name);
    if (!surname) continue;
    const person: RosterPerson = { surname, initials, formName: normaliseName(`${surname} ${initials}`), level: '', active: true, role: 'SIL', aliases: [] };
    roster.push(person);
    fromDebrief.set(person, new Set([d.levelText]));
  }
  for (const [person, answers] of fromDebrief) {
    const given = [...answers].filter(Boolean);
    const levels = new Set(given.map((t) => levelOf(t, settings)));
    if (given.length && levels.size === 1 && !levels.has(null)) person.level = given[0]!;
  }

  // Every name in the sources, matched to the list once.
  const matches = new Map<string, MatchResult>();
  const match = (name: string) => {
    let m = matches.get(name);
    if (!m) {
      m = matchName(name, roster);
      matches.set(name, m);
      if (m.matched && m.how !== 'exact') add('names', m.person.formName, `"${name}" was matched to ${m.person.formName} (${m.how === 'alias' ? 'an alias on the list' : 'one letter different'}).`);
    }
    return m;
  };
  const work = new Map<RosterPerson, { rows: RegisterRow[]; debrief: DebriefRow[]; classes: LecturerClass[] }>();
  const of = (p: RosterPerson) => {
    let w = work.get(p);
    if (!w) work.set(p, (w = { rows: [], debrief: [], classes: [] }));
    return w;
  };
  const place = (name: string, source: string, where: string, date: string) => {
    const m = match(name);
    if (m.matched) return m.person;
    add('unmatched', null, `${source}, ${where} (${day(date)}): "${name || '(no name)'}": ${m.reason}.`);
    return null;
  };

  for (const r of input.register) {
    if (!r.date) {
      if (r.name) add('register-problem', r.name, `${r.where}: ${r.problem ?? 'no readable date'}, so it isn't counted in any month.`);
      continue;
    }
    if (!inMonth(r.date)) continue;
    if (!r.name) {
      add('register-problem', null, `${r.where} (${day(r.date)}): no SI Leader name.`);
      continue;
    }
    const p = place(r.name, 'Register', r.where, r.date);
    if (p) of(p).rows.push(r);
  }
  for (const d of input.debrief) {
    if (!d.date || inMonth(d.date)) {
      const p = place(d.name, 'Debrief', d.where, d.date);
      if (p && d.date) of(p).debrief.push(d);
      else if (p) add('not-in-register', p.formName, `Debrief ${d.where} has no readable date.`);
    }
  }
  for (const c of input.classes) {
    if (!inMonth(c.date)) continue;
    const p = place(c.name, 'Class attendance', c.where, c.date);
    if (p) of(p).classes.push(c);
  }

  const people: PersonResult[] = [];
  for (const person of roster) {
    const w = work.get(person) ?? { rows: [], debrief: [], classes: [] };
    const who = person.formName;
    const level = levelFromList(person.level, settings);
    const rateCents = level ? parseRand(settings.rates[level]) : null;
    const debriefAnswers = fromDebrief.get(person);

    if (person.role === 'Admin') {
      if (!person.active) continue;
      const totalMinutes = settings.adminHours * 60;
      people.push({ person, level, rateCents, claim: null, totalMinutes, amountCents: rateCents === null ? null : amountCents(totalMinutes, rateCents) });
      add('admins', who, `Claimed at ${settings.adminHours}h${rateCents === null ? '' : ` x ${formatRand(rateCents)}`}. What goes on an administrator's form lines hasn't been decided yet, so no form is made.`);
      const observedBy = (r: RegisterRow) => {
        const m = r.observer ? match(r.observer) : null;
        return m?.matched ? m.person : null;
      };
      const observed = input.register.filter((r) => inMonth(r.date) && r.claimed && observedBy(r) === person);
      if (observed.length) {
        const byRules = buildSilClaim({ sessions: observed.map((r) => ({ date: r.date, start: r.start!, end: r.end! })), classes: [], rateCents: rateCents ?? 0 }, settings);
        add('admins', who, `Observed ${observed.length} session${observed.length === 1 ? '' : 's'}: ${formatHours(byRules.uncappedMinutes)}h by the same rules.`);
      }
      if (rateCents === null) add('levels', who, `The list gives the level as "${person.level}", which isn't a level the rates know, so there's no rate.`);
      continue;
    }

    // Register rows the rules can't use, or that their colour leaves out, and times taken from the debrief.
    for (const r of w.rows) {
      if (r.problem) add('register-problem', who, `${day(r.date)} ${r.time || '(no time)'} (${r.where}): ${r.problem}.`);
      else if (!r.claimed) add('left-out', who, `${day(r.date)} ${r.time} (${r.where}): ${r.meaning}.`);
      if (r.timeFrom) add('filled', who, `${day(r.date)}: ${formatTime(r.start!)}-${formatTime(r.end!)}, ${r.timeFrom}.`);
    }
    // Register vs debrief: the register wins.
    const cc = crossCheck(w.rows, w.debrief);
    if (cc.notInDebrief.length) add('not-on-debrief', who, cc.notInDebrief.map((r) => day(r.date)).join(', '));
    for (const d of cc.notInRegister) {
      add('not-in-register', who, `${day(d.date)} ${d.start === null ? '?' : formatTime(d.start)}-${d.end === null ? '?' : formatTime(d.end)} (debrief ${d.where}).`);
    }
    for (const { register: r, debrief: d } of cc.forLeftOut) {
      add('not-in-register', who, `${day(r.date)}: the register marks it "${r.meaning}", but there's a debrief for it (${d.where}).`);
    }

    const sessions = w.rows.filter((r) => r.claimed).map((r) => ({ date: r.date, start: r.start!, end: r.end!, module: r.module }));
    const classes = w.classes.map((c) => ({ date: c.date, module: c.module, start: c.start }));
    if (!sessions.length && !classes.length) continue;

    if (!person.active) add('names', who, 'is marked inactive on the list, but has sessions or classes this month.');
    if (debriefAnswers) {
      const onList = input.roster.filter((p) => p.surname === person.surname).map((p) => p.formName);
      add(
        'names',
        who,
        `isn't on the SI list${onList.length ? ` (the list has ${onList.join(', ')})` : ''}, so the name and level come from the debrief, and the control list has no student number for them.`,
      );
    }
    if (rateCents === null && debriefAnswers) {
      const given = [...debriefAnswers].filter(Boolean);
      add('levels', who, `Not on the SI list, and the debrief ${given.length ? `gives ${given.map((t) => `"${t}"`).join(' and ')}` : 'gives no level'}, so there's no rate.`);
    } else if (rateCents === null) {
      add('levels', who, `The list gives the level as "${person.level || '(blank)'}", which isn't a level the rates know, so there's no rate.`);
    }
    const debriefLevels = [...new Set(w.debrief.map((d) => d.levelText).filter((t) => t && levelOf(t, settings) !== level))];
    if (level && debriefLevels.length) add('levels', who, `The debrief says ${debriefLevels.map((t) => `"${t}"`).join(' and ')}, but the list says ${level}. The list is used.`);

    const claim = buildSilClaim({ sessions, classes, rateCents: rateCents ?? 0 }, settings);
    for (const n of claim.notes) add(SECTION_FOR_NOTE[n.kind], who, n.message);
    if (claim.forms.length > 1) add('forms', who, `The lines don't fit on one form even after combining, so the claim uses ${claim.forms.length} forms.`);
    people.push({
      person,
      level,
      rateCents,
      claim,
      totalMinutes: claim.totalMinutes,
      amountCents: rateCents === null ? null : claim.amountCents,
    });
  }

  people.sort((a, b) => a.person.surname.localeCompare(b.person.surname) || a.person.initials.localeCompare(b.person.initials));
  const order = Object.keys(CHECK_SECTIONS);
  // By section, then alphabetical by person; each person's checks stay in the order they arose.
  checks.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section) || (a.person ?? '').localeCompare(b.person ?? '', undefined, { sensitivity: 'base' }));
  return {
    people,
    checks,
    totalCents: people.reduce((s, p) => s + (p.amountCents ?? 0), 0),
    complete: people.every((p) => p.amountCents !== null),
  };
}
