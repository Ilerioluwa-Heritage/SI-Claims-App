// The website's one page, in the order of the brief: choose the month, upload
// the files, review the checks, generate, download. Everything runs in this
// browser; no file is sent anywhere.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { demoMonth } from '../../src/app/demo.ts';
import { makeDownloads, type Downloads } from '../../src/app/downloads.ts';
import { DEFAULT_SETTINGS as S, MONTH_NAMES, SOURCE_NAMES, missingSources } from '../../src/core/index.ts';
import { checkClaimForm } from '../../src/pdf/fill.ts';
import { readDebrief, type DebriefRow } from '../../src/read/debrief.ts';
import { readClassAttendance, type ClassFile } from '../../src/read/class-attendance.ts';
import { readLevelsList } from '../../src/read/levels-list.ts';
import { readRegister, type RegisterRow } from '../../src/read/register.ts';
import { levelFromList, rosterWithAdmins, runMonth, type Check } from '../../src/run/month.ts';
import { Editor, type FormFile } from './Editor.tsx';
import { Results, type Run } from './Results.tsx';
import { bytesOf } from './save.ts';
import { getKept, removeKept, setKept, type KeptFile, type KeptList } from './storage.ts';

type Picked = { fileName: string; bytes: Uint8Array };
type Read<T> = { rows: T[] } | { error: string };

const monthName = (m: number) => (MONTH_NAMES[m - 1] ?? '').charAt(0) + (MONTH_NAMES[m - 1] ?? '').slice(1).toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

/** Claims are usually made for the month that has just ended. */
function lastMonth() {
  const now = new Date();
  return now.getMonth() === 0 ? { month: 12, year: now.getFullYear() - 1 } : { month: now.getMonth(), year: now.getFullYear() };
}

function attempt<T>(read: () => T[]): Read<T> {
  try {
    return { rows: read() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function App() {
  const [period, setPeriod] = useState(lastMonth);
  const [claimForm, setClaimForm] = useState<KeptFile | null>(null);
  const [claimFormProblems, setClaimFormProblems] = useState<string[]>([]);
  const [levels, setLevels] = useState<KeptList | null>(null);
  const [levelsError, setLevelsError] = useState('');
  const [register, setRegister] = useState<Picked | null>(null);
  const [debrief, setDebrief] = useState<Picked | null>(null);
  const [classFiles, setClassFiles] = useState<Picked[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [downloads, setDownloads] = useState<Downloads | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'monthly' | 'editor'>('monthly');
  const [editing, setEditing] = useState<FormFile | null>(null);

  useEffect(() => {
    Promise.all([getKept('claimForm'), getKept('levels')])
      .then(([form, list]) => {
        setClaimForm(form ?? null);
        setLevels(list ?? null);
      })
      .catch(() => setError("This browser won't let the app keep files, so they'll have to be uploaded each time."));
  }, []);

  async function keepLevels(fileName: string, bytes: Uint8Array) {
    setLevelsError('');
    try {
      // Only the name, student number and level of each person are read and kept; not the file.
      const { people, problems } = readLevelsList(bytes, S);
      const kept = { fileName, keptSince: today(), people, problems };
      setLevels(kept);
      startOver();
      await setKept('levels', kept).catch(() => setError("The list is ready to use, but this browser wouldn't keep it for next time."));
    } catch (e) {
      setLevelsError((e as Error).message);
    }
  }

  async function removeLevels() {
    if (!window.confirm('Remove the kept list of SI Leaders? You can upload a newer version afterwards.')) return;
    await removeKept('levels').catch(() => undefined);
    setLevels(null);
    startOver();
  }

  const debriefRows = useMemo(() => (debrief ? attempt<DebriefRow>(() => readDebrief(debrief.bytes, S)) : null), [debrief]);
  const registerRows = useMemo(
    () => (register ? attempt<RegisterRow>(() => readRegister(register.bytes, S, debriefRows && 'rows' in debriefRows ? debriefRows.rows : [])) : null),
    [register, debriefRows],
  );
  const classesRead = useMemo(
    () =>
      classFiles.map((f): ClassFile | { fileName: string; error: string } => {
        try {
          return readClassAttendance(f.bytes, f.fileName, S);
        } catch (e) {
          return { fileName: f.fileName, error: (e as Error).message };
        }
      }),
    [classFiles],
  );
  const classesOk = classesRead.filter((c): c is ClassFile => 'classes' in c);
  const readOk = (r: Read<unknown> | null) => (r && 'rows' in r ? r : undefined);
  const missing = missingSources({
    claimForm: claimForm ?? undefined,
    levels: levels ?? undefined,
    register: readOk(registerRows),
    debrief: readOk(debriefRows),
    classAttendance: classesOk.length ? classesOk : undefined,
  });
  const noRate = levels ? levels.people.filter((p) => !levelFromList(p.level, S)).length : 0;
  const prefix = `${period.year}-${String(period.month).padStart(2, '0')}-`;
  const label = `${monthName(period.month)} ${period.year}`;

  /** Anything that changes what was read clears earlier results. */
  const startOver = () => {
    setRun(null);
    setDownloads(null);
    setError('');
  };

  async function keepClaimForm(fileName: string, bytes: Uint8Array) {
    setBusy('Checking the blank form...');
    try {
      const problems = await checkClaimForm(bytes);
      setClaimFormProblems(problems);
      if (problems.length) return;
      const kept = { fileName, bytes, keptSince: today() };
      setClaimForm(kept);
      setDownloads(null);
      await setKept('claimForm', kept).catch(() => setError("The form is ready to use, but this browser wouldn't keep it for next time."));
    } finally {
      setBusy('');
    }
  }

  async function removeClaimForm() {
    if (!window.confirm('Remove the kept blank HRM-05? You can upload a newer version afterwards.')) return;
    await removeKept('claimForm').catch(() => undefined);
    setClaimForm(null);
    setDownloads(null);
  }

  /** Only when trying the app on this computer: the test copy of the blank form. Left out of the real website. */
  const useTestCopy = import.meta.env.DEV
    ? async () => {
        const { default: url } = await import('../../tests/fixtures/HRM-05 blank.pdf?url');
        await keepClaimForm('HRM-05 blank.pdf (test copy)', new Uint8Array(await (await fetch(url)).arrayBuffer()));
      }
    : null;

  /** The real run: everything uploaded, through the rules. */
  function checkMonth() {
    if (missing.length || !levels || !registerRows || !debriefRows || !('rows' in registerRows) || !('rows' in debriefRows)) return;
    const result = runMonth(
      {
        month: period.month,
        year: period.year,
        register: registerRows.rows,
        debrief: debriefRows.rows,
        classes: classesOk.flatMap((f) => f.classes),
        roster: rosterWithAdmins(levels.people, S),
      },
      S,
    );
    // What the files themselves couldn't settle goes into the checks too.
    const fileChecks: Check[] = [
      ...levels.problems.map((message): Check => ({ section: 'names', person: null, message: `SI list, ${message}` })),
      ...classesOk.flatMap((f) => f.problems.map((message): Check => ({ section: 'classes', person: f.name, message }))),
      ...classesOk.filter((f) => f.nameFrom === 'file name').map((f): Check => ({ section: 'classes', person: f.name, message: `${f.fileName}: the SI Leader's name was taken from the file's name.` })),
    ];
    setDownloads(null);
    setError('');
    setRun({ result: { ...result, checks: [...fileChecks, ...result.checks] }, demo: false, month: period.month, year: period.year });
  }

  function tryMadeUpMonth() {
    const input = demoMonth();
    setPeriod({ month: input.month, year: input.year });
    setDownloads(null);
    setError('');
    setRun({ result: runMonth(input, S), demo: true, month: input.month, year: input.year });
  }

  async function makeForms() {
    if (!run || !claimForm) return;
    setBusy('Filling the claim forms...');
    setError('');
    try {
      setDownloads(await makeDownloads(run.result, claimForm.bytes, run.month, run.year, S));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const registerStatus = (r: Read<RegisterRow>) => {
    if ('error' in r) return <span className="bad">{r.error}</span>;
    const rows = r.rows.filter((x) => x.date.startsWith(prefix));
    const leftOut = rows.filter((x) => !x.claimed && !x.problem).length;
    const flagged = rows.filter((x) => x.problem).length;
    return (
      <span className="ok">
        {rows.length} sessions in {label}: {rows.length - leftOut - flagged} to claim, {leftOut} left out by colour, {flagged} to look at
      </span>
    );
  };
  const debriefStatus = (r: Read<DebriefRow>) =>
    'error' in r ? <span className="bad">{r.error}</span> : <span className="ok">{r.rows.filter((x) => x.date.startsWith(prefix)).length} debriefs in {label}</span>;

  return (
    <main>
      <header>
        <h1>SI Claim Forms</h1>
        <p>Centre for Academic Excellence: Supplemental Instruction</p>
      </header>
      <nav className="tabs">
        <button className={tab === 'monthly' ? 'on' : ''} onClick={() => setTab('monthly')}>
          Monthly claims
        </button>
        <button className={tab === 'editor' ? 'on' : ''} onClick={() => setTab('editor')}>
          Claim form editor
        </button>
      </nav>

      <div hidden={tab !== 'editor'}>
        <Editor blankForm={claimForm?.bytes ?? null} incoming={editing} />
      </div>

      <div hidden={tab !== 'monthly'}>
      <section className="card">
        <h2>1. Month</h2>
        <div className="row">
          <select
            aria-label="Month"
            value={period.month}
            onChange={(e) => {
              setPeriod({ ...period, month: Number(e.target.value) });
              startOver();
            }}
          >
            {MONTH_NAMES.map((_, i) => (
              <option key={i} value={i + 1}>
                {monthName(i + 1)}
              </option>
            ))}
          </select>
          <input
            aria-label="Year"
            type="number"
            min={2020}
            max={2100}
            value={period.year}
            onChange={(e) => {
              setPeriod({ ...period, year: Number(e.target.value) });
              startOver();
            }}
          />
        </div>
      </section>

      <section className="card">
        <h2>2. Kept on this device</h2>
        <p className="hint">Uploaded once and kept until you remove them, for example when there's a new version.</p>
        <Slot title={SOURCE_NAMES.claimForm}>
          {claimForm ? (
            <>
              <span className="ok">
                {claimForm.fileName}, kept since {claimForm.keptSince}
              </span>
              <div className="buttons">
                <Pick label="Replace" accept=".pdf" onPick={async (f) => keepClaimForm(f.name, await bytesOf(f))} />
                <button className="secondary" onClick={removeClaimForm}>
                  Remove
                </button>
              </div>
            </>
          ) : (
            <div className="buttons">
              <Pick label="Upload the blank form (PDF)" accept=".pdf" onPick={async (f) => keepClaimForm(f.name, await bytesOf(f))} />
              {useTestCopy && (
                <button className="secondary" onClick={useTestCopy}>
                  Use the test copy (this computer only)
                </button>
              )}
            </div>
          )}
          {claimFormProblems.length > 0 && (
            <div className="bad">
              That form can't be used:
              <ul>
                {claimFormProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </Slot>
        <Slot title={`${SOURCE_NAMES.levels} (Word)`}>
          {levels ? (
            <>
              <span className="ok">
                {levels.fileName}: {levels.people.length} SI Leaders, kept since {levels.keptSince}
                {noRate > 0 && <span className="bad"> ({noRate} with a level that has no rate)</span>}
              </span>
              <div className="buttons">
                <Pick label="Replace" accept=".docx" onPick={async (f) => keepLevels(f.name, await bytesOf(f))} />
                <button className="secondary" onClick={removeLevels}>
                  Remove
                </button>
              </div>
            </>
          ) : (
            <Pick label="Upload the list (.docx)" accept=".docx" onPick={async (f) => keepLevels(f.name, await bytesOf(f))} />
          )}
          <span className="hint">Only each person's name, student number and level are kept; the Contact column is never read.</span>
          {levels && levels.problems.length > 0 && (
            <ul className="bad">
              {levels.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {levelsError && <span className="bad">{levelsError}</span>}
        </Slot>
      </section>

      <section className="card">
        <h2>3. This month's files</h2>
        <p className="hint">Read on this device only, and not kept after you close the page.</p>
        <Slot title={`${SOURCE_NAMES.register} (Word)`}>
          {register && registerRows && <div>{register.fileName}: {registerStatus(registerRows)}</div>}
          <Pick
            label={register ? 'Choose a different file' : 'Upload the register (.docx)'}
            accept=".docx"
            onPick={async (f) => {
              setRegister({ fileName: f.name, bytes: await bytesOf(f) });
              startOver();
            }}
          />
        </Slot>
        <Slot title={`${SOURCE_NAMES.debrief} (Excel)`}>
          {debrief && debriefRows && <div>{debrief.fileName}: {debriefStatus(debriefRows)}</div>}
          <Pick
            label={debrief ? 'Choose a different file' : 'Upload the debrief (.xlsx)'}
            accept=".xlsx"
            onPick={async (f) => {
              setDebrief({ fileName: f.name, bytes: await bytesOf(f) });
              startOver();
            }}
          />
        </Slot>
        <Slot title={`${SOURCE_NAMES.classAttendance} (Excel, one per SI Leader)`}>
          {classesRead.length > 0 && (
            <ul className="files-read">
              {classesRead.map((f) => (
                <li key={f.fileName}>
                  {f.fileName}:{' '}
                  {'error' in f ? (
                    <span className="bad">{f.error}</span>
                  ) : (
                    <span className={f.problems.length ? 'bad' : 'ok'}>
                      {f.name ?? 'no SI Leader name'}, {f.classes.filter((c) => c.date.startsWith(prefix)).length} classes in {label}
                      {f.problems.length > 0 && ` (${f.problems.length} to look at)`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="buttons">
            <PickMany
              label={classFiles.length ? 'Add more files' : 'Upload the class attendance (.xlsx)'}
              accept=".xlsx"
              onPick={async (files) => {
                const picked = await Promise.all(files.map(async (f) => ({ fileName: f.name, bytes: await bytesOf(f) })));
                setClassFiles((now) => [...now.filter((x) => !picked.some((p) => p.fileName === x.fileName)), ...picked]);
                startOver();
              }}
            />
            {classFiles.length > 0 && (
              <button
                className="secondary"
                onClick={() => {
                  setClassFiles([]);
                  startOver();
                }}
              >
                Clear
              </button>
            )}
          </div>
          <span className="hint">Only the lecturers' rows are counted. The email, student number and lecturer's name are never read.</span>
        </Slot>
      </section>

      <section className="card">
        <h2>4. Check the month</h2>
        {missing.length > 0 && <p className="hint">Still needed: {missing.map((s) => SOURCE_NAMES[s]).join(', ')}.</p>}
        <div className="buttons">
          <button disabled={missing.length > 0} onClick={checkMonth}>
            Check {label}
          </button>
          <button className="secondary" onClick={tryMadeUpMonth}>
            Try it with made-up data
          </button>
        </div>
      </section>

      {run && (
        <Results
          run={run}
          downloads={downloads}
          canMakeForms={!!claimForm}
          busy={!!busy}
          onMakeForms={makeForms}
          onEdit={(f) => {
            setEditing({ fileName: f.fileName, bytes: f.bytes });
            setTab('editor');
          }}
        />
      )}
      {error && <p className="bad card">{error}</p>}
      </div>
      {busy && <div className="busy">{busy}</div>}
    </main>
  );
}

function Slot({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="slot">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function Pick({ label, accept, onPick }: { label: string; accept: string; onPick: (f: File) => void | Promise<void> }) {
  return (
    <label className="button">
      {label}
      <input
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onPick(file);
        }}
      />
    </label>
  );
}

function PickMany({ label, accept, onPick }: { label: string; accept: string; onPick: (files: File[]) => void | Promise<void> }) {
  return (
    <label className="button">
      {label}
      <input
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void onPick(files);
        }}
      />
    </label>
  );
}
