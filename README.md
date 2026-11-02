# SI Claim Form Generator

Builds the monthly HRM-05 Student Assistance claim forms for the Supplemental
Instruction (SI) programme at the Centre for Academic Excellence, University of
Limpopo, from the SI Leaders' daily session register, the debrief form and the
lecturers' class attendance records.

## What you upload each month

Every run needs all three files. It won't start if any is missing.

1. **Daily session register.** Session times come from here.
2. **Debrief form.** Used only to cross-check the register. Sessions that appear in one but not the other are flagged.
3. **Class attendance (lecturers' records).** Classes are taken only from what the lecturers recorded. The SI Leaders' own class records aren't used.

Download each one from Google Sheets (File → Download → Microsoft Excel) and upload it.

One program serves as both the website and the phone app. It's a web app that
can be installed on Android and iPhone from the browser, so both always give
identical results.

## Where things stand

| Stage | What | Status |
|---|---|---|
| 1 | Claim rules and their tests | **In progress.** Rules written and tested; waiting for the October 2026 data to compare against |
| 2 | Filling the HRM-05 PDF | Not started |
| 3 | Website: upload, checks, downloads, control list | Not started |
| 4 | Installing on phones | Not started |
| 5 | Reading straight from Google Sheets | Set aside: you chose to always upload the three files (2 Nov 2026) |
| 6 | Putting it online | Not started |

### Decisions still open (these affect what goes on the form)

1. **Data allowance with only one session.** Right now that session gets both hours.
2. **The 80-hour cap.** The total is capped, but which lines are reduced so the lines still add up to 80 hasn't been decided.
3. **Administrators' forms.** The total is fixed at 80 hours, but what goes on each line hasn't been decided.

### Decided

- **Class attendance (2 Nov 2026).** Classes come only from the lecturers' records, not the SI Leaders' own records. Each class line shows the lecturer's actual lecture time, not rounded (11H10–13H10).
- **Uploads (2 Nov 2026).** All three files are uploaded for every run; nothing is read straight from Google.

## What's in this folder

| Folder / file | What it is |
|---|---|
| `src/core/` | **The claim rules, and the only place they live.** The website, the phone app and the tests all use these files. |
| `src/core/sources.ts` | The three files every run needs. |
| `src/core/settings.ts` | Rates, prep hours, data allowance bands, the cap, the 23H30 limit, and the fixed text on the form (G082, PROF O CHABAYA and so on). |
| `tests/` | Automated checks for every rule, including the edge cases. |
| `scripts/demo.ts` | A made-up SI Leader's month, worked through step by step. |

Real data (exports, submitted forms, generated PDFs) is never stored in this
folder or on GitHub. It stays in OneDrive. The `.gitignore` file blocks
spreadsheets and PDFs from being saved here by accident.

## How to run it (on this computer)

You need Node.js and Git. They were installed on 2 November 2026.

1. Open **PowerShell**: press Start, type `powershell`, then press Enter.
2. Go to this folder:

   ```
   cd C:\Users\Proline\SI-Claims-App
   ```

3. The first time only (or after downloading a fresh copy), fetch the helper libraries:

   ```
   npm install
   ```

4. **Run all the tests.** Every line should have a green tick, and the summary should say `passed`:

   ```
   npm test
   ```

5. **See a worked example.** This prints a made-up month showing each step: rounding, prep hours, data allowance, the midnight limit, class attendance and the total:

   ```
   npm run demo
   ```

If a test fails, don't hand anything over. A failing test means a rule
gives a different answer from what it should.

## The claim rules (summary)

Full details are in `src/core/rules.ts`, with a comment on every rule.

1. The daily register is the source of truth for session times.
2. Times are rounded to the half hour first. A start on :15 or :45 goes back; an end on :15 or :45 goes forward.
3. 2 hours of preparation are added to every SI session.
4. Data allowance: 1-4 sessions get 2h, 5-8 get 3h, 9 or more get 4h. It's given one hour per session, starting from the earliest session.
5. Added hours extend the end time. Nothing may end after 23H30; any extra moves onto the start time instead.
6. Classes come only from the lecturers' class attendance records. Each class is worth 2h from the lecturer's actual lecture start, which isn't rounded (11H10–13H10). Two classes on one day share a line.
7. SI sessions come first, then classes, each in date order.
8. The total is capped at 80 hours.
9. Administrators are claimed at 80 hours.
10. Money = hours × rate, rounded half-up to the cent, using exact arithmetic.
11. With more than 13 lines, lines with the same service and times are combined (`10&14&17/09/2026`). Anything still left over goes onto a second page.
