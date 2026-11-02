// Every number that decides pay lives here, so it can be changed in one place
// (and later from the Settings screen) without touching the rules themselves.

export const LEVELS = ['2nd year', '3rd year', '4th year', 'PGCE', 'Honours', 'Masters', 'PhD'] as const;
export type Level = (typeof LEVELS)[number];

export interface AllowanceBand {
  /** Smallest number of SI sessions in the month that earns this band. */
  minSessions: number;
  hours: number;
}

export interface Settings {
  /** Rand per hour by level of study, as decimal text ("36.50") so no float creeps in. */
  rates: Record<Level, string>;
  /** Preparation hours added to every SI session (rule 3). */
  prepHoursPerSession: number;
  /** Monthly data allowance by number of SI sessions (rule 4). Highest matching band wins. */
  dataAllowanceBands: AllowanceBand[];
  /** Latest end time allowed on a claim (rule 5), e.g. "23H30". */
  latestEndTime: string;
  /** Hours credited for each confirmed class (rule 6). */
  classHours: number;
  /** Monthly cap per person (rule 8). */
  monthlyCapHours: number;
  /** Hours claimed for each administrator (rule 9). */
  adminHours: number;
  /** Usable session lines on one HRM-05 page (rule 11). */
  rowsPerPage: number;

  // Fixed text on the HRM-05.
  schoolName: string;
  costCentreNo: string;
  costCentreName: string;
  programmeName: string;
  signatoryName: string;
  signatoryPersonnelNo: string;
}

export const DEFAULT_SETTINGS: Settings = {
  rates: {
    '2nd year': '36.50',
    '3rd year': '36.50',
    '4th year': '36.50',
    PGCE: '36.50',
    Honours: '47.00',
    Masters: '62.00',
    PhD: '83.00',
  },
  prepHoursPerSession: 2,
  dataAllowanceBands: [
    { minSessions: 1, hours: 2 },
    { minSessions: 5, hours: 3 },
    { minSessions: 9, hours: 4 },
  ],
  latestEndTime: '23H30',
  classHours: 2,
  monthlyCapHours: 80,
  adminHours: 80,
  rowsPerPage: 13,

  schoolName: 'CAE (SI)',
  costCentreNo: 'G082',
  costCentreName: 'UCDP STUDENT S & A',
  programmeName: 'SI PROGRAMME',
  signatoryName: 'PROF O CHABAYA',
  signatoryPersonnelNo: '9951504',
};
