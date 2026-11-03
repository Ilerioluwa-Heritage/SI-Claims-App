// The website's one page, in the order of the brief: choose the month, upload
// the files, review the checks, generate, download. Everything runs in this
// browser; no file is sent anywhere.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { demoMonth } from '../../src/app/demo.ts';
import { makeDownloads, type Downloads } from '../../src/app/downloads.ts';
import { DEFAULT_SETTINGS as S, MONTH_NAMES, SOURCE_NAMES, missingSources } from '../../src/core/index.ts';
import { checkClaimForm } from '../../src/pdf/fill.ts';
import { readDebrief, type DebriefRow } from '../../src/read/debrief.ts';
import { readRegister, type RegisterRow } from '../../src/read/register.ts';
import { runMonth, type MonthResult } from '../../src/run/month.ts';
import { Editor, type FormFile } from './Editor.tsx';
import { Results, type Run } from './Results.tsx';
import { bytesOf } from './save.ts';
import { getKept, removeKept, setKept, type KeptFile } from './storage.ts';

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
  const [register, setRegister] = useState<Picked | null>(null);
  const [debrief, setDebrief] = useState<Picked | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [downloads, setDownloads] = useState<Downloads | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'monthly' | 'editor'>('monthly');
  const [editing, setEditing] = useState<FormFile | null>(null);

  useEffect(() => {
    getKept('claimForm')
      .then((f) => setClaimForm(f ?? null))
      .catch(() => setError("This browser won't let the app keep files, so the blank form will have to be uploaded each time."));
  }, []);

  const debriefRows = useMemo(() => (debrief ? attempt<DebriefRow>(() => readDebrief(debrief.bytes, S)) : null), [debrief]);
  const registerRows = useMemo(
    () => (register ? attempt<RegisterRow>(() => readRegister(register.bytes, S, debriefRows && 'rows' in debriefRows ? debriefRows.rows : [])) : null),
    [register, debriefRows],
  );
  const readOk = (r: Read<unknown> | null) => (r && 'rows' in r ? r : undefined);
  const missing = missingSources({ claimForm: claimForm ?? undefined, register: readOk(registerRows), debrief: readOk(debriefRows) });
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
        <Slot title={SOURCE_NAMES.levels}>
          <span className="waiting">Not set up yet: send a sample of the list, so the app can learn its columns.</span>
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
        <Slot title={SOURCE_NAMES.classAttendance}>
          <span className="waiting">Not set up yet: send a sample of the lecturers' file, so the app can learn its columns.</span>
        </Slot>
      </section>

      <section className="card">
        <h2>4. Check the month</h2>
        {missing.length > 0 && <p className="hint">Still needed: {missing.map((s) => SOURCE_NAMES[s]).join(', ')}.</p>}
        <div className="buttons">
          <button disabled={missing.length > 0}>Check {label}</button>
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
