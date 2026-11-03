// After a run: the summary, the checks report, and the claim forms to download.

import type { Downloads } from '../../src/app/downloads.ts';
import { MONTH_NAMES, formatHours, formatRand } from '../../src/core/index.ts';
import { CHECK_SECTIONS, type CheckSection, type MonthResult } from '../../src/run/month.ts';
import { save } from './save.ts';

export interface Run {
  result: MonthResult;
  /** Made-up data, for trying the app. */
  demo: boolean;
  month: number;
  year: number;
}

/** Sections opened from the start: they need someone to act. */
const NEEDS_ACTION = new Set<CheckSection>(['unmatched', 'register-problem', 'not-in-register', 'levels']);

export function Results({ run, downloads, canMakeForms, busy, onMakeForms }: { run: Run; downloads: Downloads | null; canMakeForms: boolean; busy: boolean; onMakeForms: () => void }) {
  const { result } = run;
  const checks = downloads?.checks ?? result.checks;
  const label = `${MONTH_NAMES[run.month - 1]} ${run.year}`;

  return (
    <>
      <section className="card">
        <h2>5. Summary: {label}</h2>
        {run.demo && <p className="demo">Made-up data, for trying the app. These aren't real claims.</p>}
        {!result.complete && <p className="warn">Some amounts are missing because there's no rate. See "Levels and rates" below.</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="n">Hours</th>
                <th className="n">Rate</th>
                <th className="n">Amount</th>
              </tr>
            </thead>
            <tbody>
              {result.people.map((p) => (
                <tr key={p.person.formName}>
                  <td>
                    {p.person.formName}
                    {p.person.role === 'Admin' && <span className="tag">admin</span>}
                  </td>
                  <td className="n">{formatHours(p.totalMinutes)}</td>
                  <td className="n">{p.rateCents === null ? '-' : formatRand(p.rateCents)}</td>
                  <td className="n">{p.amountCents === null ? 'no rate' : formatRand(p.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total ({result.people.length} people)</td>
                <td className="n">{formatRand(result.totalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>6. Checks</h2>
        {(Object.keys(CHECK_SECTIONS) as CheckSection[]).map((key) => {
          const items = checks.filter((c) => c.section === key);
          if (!items.length) return null;
          return (
            <details key={key} open={NEEDS_ACTION.has(key)}>
              <summary>
                {CHECK_SECTIONS[key]} <span className="count">{items.length}</span>
              </summary>
              <ul>
                {items.map((c, i) => (
                  <li key={i}>
                    {c.person && <b>{c.person}: </b>}
                    {c.message}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </section>

      <section className="card">
        <h2>7. Claim forms and downloads</h2>
        {!downloads ? (
          <>
            {!canMakeForms && <p className="hint">Upload the blank HRM-05 in step 2 first.</p>}
            <button disabled={!canMakeForms || busy} onClick={onMakeForms}>
              Make the claim forms
            </button>
          </>
        ) : (
          <>
            <p>
              {downloads.forms.length} claim form{downloads.forms.length === 1 ? '' : 's'} ready
              {run.demo ? ' (made-up data)' : ''}.
            </p>
            <div className="buttons">
              <button onClick={() => save(downloads.zip.fileName, downloads.zip.bytes, downloads.zip.type)}>Download everything (zip)</button>
              <button className="secondary" onClick={() => save(downloads.controlList.fileName, downloads.controlList.bytes, downloads.controlList.type)}>
                Control list (Excel)
              </button>
              <button className="secondary" onClick={() => save(downloads.report.fileName, downloads.report.bytes, downloads.report.type)}>
                Checks report
              </button>
            </div>
            <h3>One at a time</h3>
            <ul className="files">
              {downloads.forms.map((f) => (
                <li key={f.fileName}>
                  <button className="link" onClick={() => save(f.fileName, f.bytes, f.type)}>
                    {f.fileName}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
