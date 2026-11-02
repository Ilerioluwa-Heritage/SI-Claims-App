import { describe, expect, it } from 'vitest';
import { matchName, splitName, type RosterPerson } from '../src/core/index.ts';

const person = (surname: string, initials: string, aliases: string[] = []): RosterPerson => ({
  surname,
  initials,
  formName: `${surname} ${initials}`,
  level: '3rd year',
  active: true,
  role: 'SIL',
  aliases,
});

const roster = [
  person('MANTSHINA', 'NH'),
  person('MAJOE', 'RR'),
  person('RAKGELEDI', 'DM'),
  person('MABUNDA', 'YP'),
  person('MALEMA', 'BP'),
  person('MALEMA', 'MR'),
  person('MOKGOTHO', 'PA'),
];

const who = (raw: string, list = roster) => {
  const r = matchName(raw, list);
  return r.matched ? `${r.person.formName} (${r.how}${r.initialsChecked ? '' : ', no initials'})` : `NO MATCH: ${r.reason}`;
};

describe('reading a typed name', () => {
  it.each([
    ['MANTSINA. NH', 'MANTSINA', 'NH'],
    ['Mantshina NH', 'MANTSHINA', 'NH'],
    ['N.H. Mantshina', 'MANTSHINA', 'NH'],
    ['Rakgaledi', 'RAKGALEDI', ''],
    ['  mabunda,  y.p ', 'MABUNDA', 'YP'],
  ])('"%s" -> %s / %s', (raw, surname, initials) => {
    expect(splitName(raw)).toEqual({ surname, initials });
  });
});

describe('matching names to the roster', () => {
  it.each([
    ['Mantshina NH', 'MANTSHINA NH (exact)'],
    ['N.H. Mantshina', 'MANTSHINA NH (exact)'],
    ['MANTSINA. NH', 'MANTSHINA NH (spelling)'],
    ['Mojoe RR', 'MAJOE RR (spelling)'],
    ['Rakgaledi', 'RAKGELEDI DM (spelling, no initials)'],
    ['Malema MR', 'MALEMA MR (exact)'],
  ])('"%s" -> %s', (raw, expected) => {
    expect(who(raw)).toBe(expected);
  });

  it.each([
    ['', 'NO MATCH: name is blank'],
    ['   ', 'NO MATCH: name is blank'],
    ['Malema', 'NO MATCH: more than one MALEMA on the roster'],
    ['MOKGOTHO PM', `NO MATCH: initials "PM" don't match the roster`],
    ['Mbunde YP', 'NO MATCH: not on the roster'], // two letters off is too far
    ['Smith AB', 'NO MATCH: not on the roster'],
  ])('"%s" is reported, not guessed: %s', (raw, expected) => {
    expect(who(raw)).toBe(expected);
  });

  it('an alias on the roster settles a name the rules would reject', () => {
    const withAlias = roster.map((p) => (p.surname === 'MOKGOTHO' ? { ...p, aliases: ['Mokgotho PM'] } : p));
    expect(who('MOKGOTHO. P.M.', withAlias)).toBe('MOKGOTHO PA (alias)');
  });

  it('a one-letter slip is not accepted when two roster names are both one letter away', () => {
    const list = [person('MOLOTO', 'AM'), person('MOLOTA', 'AM')];
    expect(who('MOLOTU AM', list)).toBe('NO MATCH: close to more than one roster name');
  });
});
