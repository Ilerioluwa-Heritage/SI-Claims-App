// The claim form editor (stage 4): upload any HRM-05, filled or blank, change
// it by typing what to do, see each change before it's made, and download the
// corrected form. The SI Leader's own details on the form are never read and
// stay exactly as they are.

import { useEffect, useState, type FormEvent } from 'react';
import { saveEditedForm } from '../../src/app/edit-files.ts';
import { COMMAND_EXAMPLES, DEFAULT_SETTINGS as S, MONTH_NAMES, claimFromForm, editClaim, formatDates, formatRand, recalculate, showHours, type EditResult, type EditableClaim } from '../../src/core/index.ts';
import { readClaimForm } from '../../src/pdf/fill.ts';
import { bytesOf, save } from './save.ts';

export interface FormFile {
  fileName: string;
  bytes: Uint8Array;
}

interface Change {
  command: string;
  summary: string;
  before: EditableClaim;
}

export function Editor({ blankForm, incoming }: { blankForm: Uint8Array | null; incoming: FormFile | null }) {
  const [file, setFile] = useState<FormFile | null>(null);
  const [claim, setClaim] = useState<EditableClaim | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<{ command: string; result: EditResult } | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Change[]>([]);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(f: FormFile) {
    setBusy(true);
    setFile(null);
    setClaim(null);
    setHistory([]);
    setPreview(null);
    setError('');
    setSaved(null);
    try {
      const read = await readClaimForm(f.bytes);
      if ('problems' in read) {
        setProblems(read.problems);
        return;
      }
      const { claim: c, problems: p } = claimFromForm(read.text);
      setProblems(p);
      setFile(f);
      setClaim(c);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (incoming) void open(incoming);
  }, [incoming]);

  function previewChange(e: FormEvent) {
    e.preventDefault();
    if (!claim || !input.trim()) return;
    const result = editClaim(claim, input, S);
    setSaved(null);
    if ('error' in result) {
      setError(result.error);
      setPreview(null);
    } else {
      setError('');
      setPreview({ command: input, result });
    }
  }

  function apply() {
    if (!claim || !preview) return;
    setHistory([...history, { command: preview.command, summary: preview.result.summary, before: claim }]);
    setClaim(preview.result.claim);
    setPreview(null);
    setInput('');
  }

  function undo() {
    const last = history.at(-1);
    if (!last) return;
    setClaim(last.before);
    setHistory(history.slice(0, -1));
    setPreview(null);
    setSaved(null);
  }

  async function download() {
    if (!file || !claim) return;
    setBusy(true);
    setError('');
    try {
      const out = await saveEditedForm(file, claim, blankForm, S);
      if ('error' in out) {
        setError(out.error);
        return;
      }
      for (const f of out.files) save(f.fileName, f.bytes, f.type);
      setSaved([`Downloaded ${out.files.map((f) => f.fileName).join(' and ')}.`, ...out.warnings]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const r = claim ? recalculate(claim, S) : null;

  return (
    <>
      <section className="card">
        <h2>Claim form editor</h2>
        <p className="hint">
          Upload any HRM-05, filled or blank, and change it by typing what to do. You'll see each change before it's made. The SI Leader's own details on the form are left exactly as they are, and aren't read.
        </p>
        <label className="button">
          {file ? 'Open a different form' : 'Upload a claim form (PDF)'}
          <input
            type="file"
            accept=".pdf"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) await open({ fileName: f.name, bytes: await bytesOf(f) });
            }}
          />
        </label>
        {problems.length > 0 && (
          <ul className="bad">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      {file && claim && r && (
        <>
          <section className="card">
            <h2>{file.fileName}</h2>
            <p className="hint">
              {claim.name ?? 'No name yet'} · {claim.month && claim.year ? `${MONTH_NAMES[claim.month - 1]} ${claim.year}` : 'no month yet'} · {claim.rateCents === null ? 'no rate yet' : `${formatRand(claim.rateCents)} an hour`}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Service</th>
                    <th>In</th>
                    <th>Out</th>
                    <th className="n">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{row.dates.length ? formatDates(row.dates) : '?'}</td>
                      <td>{row.service}</td>
                      <td>{row.timeIn}</td>
                      <td>{row.timeOut}</td>
                      <td className="n">{showHours(row.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>Total{r.capped ? ` (capped at ${S.monthlyCapHours}h)` : ''}</td>
                    <td className="n">
                      {showHours(r.totalMinutes)}h{r.amountCents === null ? '' : ` = ${formatRand(r.amountCents)}`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {r.forms.length > 1 && <p className="warn">These lines need a second form; it will be made from the kept blank form.</p>}
            {r.warnings.length > 0 && (
              <ul className="warn-list">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Change it</h2>
            <form className="command" onSubmit={previewChange}>
              <input aria-label="What to change" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. remove the session of the 07th" />
              <button type="submit" disabled={!input.trim()}>
                Preview
              </button>
            </form>
            {error && <pre className="bad">{error}</pre>}
            {preview && (
              <div className="preview">
                <p>{preview.result.summary}</p>
                {preview.result.notes.map((n) => (
                  <p key={n} className="warn">
                    {n}
                  </p>
                ))}
                <div className="buttons">
                  <button onClick={apply}>Apply</button>
                  <button className="secondary" onClick={() => setPreview(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {history.length > 0 && (
              <>
                <h3>Changes so far</h3>
                <ol>
                  {history.map((h, i) => (
                    <li key={i}>{h.summary}</li>
                  ))}
                </ol>
                <button className="secondary" onClick={undo}>
                  Undo the last change
                </button>
              </>
            )}
            <details>
              <summary>What you can type</summary>
              <ul>
                {COMMAND_EXAMPLES.map((ex) => (
                  <li key={ex}>
                    <button className="link" onClick={() => setInput(ex)}>
                      {ex}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className="card">
            <h2>Download</h2>
            <button disabled={busy} onClick={download}>
              Download the changed form
            </button>
            {saved && (
              <ul className="files">
                {saved.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {busy && <div className="busy">Working...</div>}
    </>
  );
}
