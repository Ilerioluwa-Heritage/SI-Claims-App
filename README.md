# SI Claim Form Generator

Builds the monthly HRM-05 Student Assistance claim forms for the Supplemental
Instruction (SI) programme at the Centre for Academic Excellence, University of
Limpopo, from the SI Leaders' daily session register, the debrief form and the
lecturers' class attendance records.

## What you upload each month

Every run needs all three files, uploaded fresh each month. It won't start if any is missing.

1. **Daily session register.** The Word document (.docx), uploaded as it is. Session times come from here. Its weekly tables give the date (written once per day), SI Leader, module, time (e.g. `15h30-17h00`), platform, number of students and observer. A row's colour marks a cancelled session, no students, or not observed.
2. **Debrief form.** Download it from Google Sheets (File → Download → Microsoft Excel). The register and the debrief must agree, but the register wins:
   - A session in the register with no debrief is **still claimed**, and listed on a side note (SI Leader and dates).
   - A debrief with no session in the register is **not claimed**, but flagged, because a session might be missing from the register.

   The debrief also fills in missing register times. Its contact-details column is never read.
3. **Class attendance (lecturers' records).** Classes are taken only from what the lecturers recorded. The SI Leaders' own class records aren't used.

## What you upload once, and replace when there's a new version

The app keeps these two until you remove them and upload a newer version, for example once a year.

1. **The list of SI Leaders and their levels.** It sets each person's rate, and it's the list names are matched against. The debrief's "Level:" answers are only checked against it. It also holds each person's **student number**. Student numbers go only into the control list's `STUDENT NO:` column (your decision, 3 Nov 2026), never onto a claim form or into the checks report.
2. **The blank HRM-05 claim form.** The app fills this form exactly as you uploaded it. Its fonts, character sizes, colours, field names and settings are never changed:
   - Each value goes into its box and is drawn in the form's own font and size.
   - Nothing is made smaller to fit. If a value is too wide for its box, the checks report says so.
   - The form's file is kept byte for byte, with the filled-in values added after it, the way a PDF reader saves a filled form.
   - When a form is uploaded, the app checks that it has every box it fills, and that it's blank (no one's details left in it). Otherwise it says what's wrong and doesn't keep it.

One program serves as both the website and the phone app. It's a web app that
can be installed on Android and iPhone from the browser, so both always give
identical results.

## Where things stand

| Stage | What | Status |
|---|---|---|
| 1 | Claim rules, reading the files, and checking against October 2026 | **In progress.** Rules, the register and debrief readers and the cross-check are done. Waiting for the lecturers' class attendance and the levels list. |
| 2 | Filling the HRM-05 PDF | **Redone 3 Nov 2026, waiting for your look at the samples.** Fills the uploaded form for each person without changing the form itself. Personal fields are left blank. A second form is used only when combining lines isn't enough. |
| 3 | Website: upload, checks, downloads, control list | **In progress.** Parts 1 and 2 are done: the month run, the control list, and the website's screens. Part 3 is half done: the SI list (levels) is read and kept. The class attendance reader waits for a sample of the lecturers' file. Until then, try the website with made-up data. The administrators' sign-in list comes when the site goes online (stage 7). |
| 4 | Claim form editor (see below) | **Done (3 Nov 2026).** It's the "Claim form editor" tab on the website. |
| 5 | Installing on phones | Not started |
| 6 | Reading straight from Google Sheets | Set aside: you chose to always upload the three files (2 Nov 2026) |
| 7 | Putting it online | Not started |

### The claim form editor (stage 4)

The website's **Claim form editor** tab is for forms that need an administrator's judgement:

1. Upload any HRM-05, filled or blank. On the Monthly claims tab, each finished form also has an **Edit** button that opens it here.
2. Type what to change and press **Preview**, for example:
   - "add a session for the 12th that's 2hrs long that began at 18H00"
   - "remove the session of the 07th"

   The full list is under "What you can type".
3. Check the preview, then **Apply** (or Cancel). **Undo the last change** steps back one change at a time.
4. The total hours and amount are worked out again after every change. **Download the changed form** to save it.

The editor reads only the boxes this program fills: name, month, year, rate, totals and the 13 lines. It writes the changes into the uploaded form without changing anything else:
- The form's fonts, sizes and settings stay the same.
- What the SI Leader typed in their own boxes (cell, student number, address, bank, signature) stays as it was, and is never read.
- If a change leaves more lines than one form holds, a second form is made from the kept blank HRM-05.

The app understands the commands itself, so nothing is sent to an AI service and the form's personal details stay on the device.

Adding a session applies the same rules as the generator (decided 3 Nov 2026). "2hrs that began at 18H00" is rounded and gets the 2h preparation added: 18H00–22H00, 4h. It also ends by 23H30, with any extra moved onto the start. If the change moves the SI Leader into a different data allowance band (e.g. 4 → 5 sessions), the editor says so and shows the command to add or remove that hour, rather than guessing which line it belongs on.

### Decisions still open (these affect what goes on the form)

1. **Data allowance with only one session.** Right now that session gets both hours.
2. **The 80-hour cap.** The total is capped, but which lines are reduced so the lines still add up to 80 hasn't been decided.
3. **Administrators' forms.** The total is fixed at 80 hours, but what goes on each line hasn't been decided.
4. **The SI list doesn't cover everyone who worked in October.** 13 people with October sessions aren't on "2026 Final SI list (1).docx" (e.g. MATLOU LL, MOLOTO AM, POPELA KS, MORUDU AT, TWALA JJ). KHOROMBI and PHOSHOKO are on it with different initials (the register has NB and PM). Their sessions can't be claimed until the list includes them.
5. **Administrators' levels.** They aren't on the SI list, so their rate is unknown until their levels are added to `admins` in `src/core/settings.ts`.

### Decided

- **Fitting the form (3 Nov 2026).** The form has 13 lines. With more lines:
  1. Class lines with the same times are combined, at most 3 classes to a line.
  2. If that's still too many, SI session lines with the same times are combined, at most 2 sessions to a line.
  3. Only if it still doesn't fit does the claim continue on a second form: an untouched copy saved as `NAME (form 2).pdf`, showing the same totals.

  If even two forms can't hold it, no form is filled and it's flagged for your decision, e.g. in the editor. No line is ever dropped. The limits (3, 2 and 2 forms) can be changed in `src/core/settings.ts`.
- **Two classes on one day (3 Nov 2026)** keep sharing a line (`07H40/14H00`), even though the form's TIME OUT box cuts off the second time at the form's own font size. The checks report flags it.

- **Class attendance (2 Nov 2026).** Classes come only from the lecturers' records, not the SI Leaders' own records. Each class line shows the lecturer's actual lecture time, not rounded (11H10–13H10).
- **Coloured register rows (2 Nov 2026).** Red (session cancelled) and green (students did not attend) rows are left out of the claim. Purple (not observed) and uncoloured rows are claimed. A colour the system doesn't know is flagged and not claimed. The colours can be changed in `src/core/settings.ts`.
- **Missing end times (2 Nov 2026).** If a register row has a start but no end time, the end time comes from that SI Leader's debrief for the same day and session. If the row has no time at all, both start and end come from the debrief. If there's no matching debrief, or it has no end time either, the row stays flagged and isn't claimed.
- **Levels not in the brief (3 Nov 2026).** PGD(NQF8) is paid as Honours (R47.00), and 1st year ECP as undergraduate (R36.50).
- **Register vs debrief (3 Nov 2026).** The register wins. A register session with no debrief is claimed and goes on the side note; a debrief with no register session isn't claimed and is flagged. A session counts as the same if it's the same SI Leader, the same day, and starts within 30 minutes.
- **Levels (3 Nov 2026).** They come from a list of SI Leaders and levels, uploaded once.
- **Uploads (2 Nov 2026).** All three files are uploaded for every run; nothing is read straight from Google.

## What's in this folder

| Folder / file | What it is |
|---|---|
| `src/core/` | **The claim rules, and the only place they live.** The website, the phone app and the tests all use these files. |
| `src/core/sources.ts` | The files the app works from: three uploaded every month, and two kept until replaced. |
| `src/core/settings.ts` | Rates, prep hours, data allowance bands, the cap, the 23H30 limit, the register's colours and column headings, and the fixed text on the form (G082, PROF O CHABAYA and so on). |
| `src/pdf/fill.ts` | Fills the uploaded HRM-05 without changing the form: each value is drawn in the box's own font and size, and the form's bytes are kept as they are. It fills only the fields on its list: name, dates, school, cost centre, month, year, hours, rate, amount, approver, and the lines. The cell number, student number, address, bank, account, branch, signatures and the approver row stay blank. It fills one form per person, or two when the rules call for a second; each is an untouched copy of the form. It also checks a newly uploaded form. |
| `tests/fixtures/HRM-05 blank.pdf` | A copy of the blank form, used only by the tests and the samples. The app uses the one you upload. |
| `src/run/month.ts` | One month, start to finish. It matches every name to the levels list and works out each person's claim. It also builds the checks report, in this order: names that couldn't be matched, register rows that couldn't be read, debriefs with no register session, the side note of register sessions with no debrief, levels and rates, rows left out by colour, times taken from the debrief, spelling matches, the cap, time moved to finish by 23H30, the data allowance, combined lines and second forms, and administrators. |
| `web/` | The website's screens, on one page that also works on a phone: month, kept files, this month's files, check, summary, checks, claim forms and downloads. Everything runs in your browser. Monthly files aren't kept; the blank form is kept on this device until you remove it. |
| `src/app/` | What the website does behind the screens: make the downloads (forms, control list, checks report, and a zip of all of them), and save the editor's changed form. It also holds a made-up month for trying the website. |
| `web/src/Editor.tsx` | The claim form editor's screen. |
| `src/out/checks-report.ts` | The checks report as a page to download, open in a browser and print. It never contains a student number. |
| `src/out/control-list.ts` | The Excel control list: the brief's columns, alphabetical by surname, with `TOTAL AMOUNT` as the live formula `=F2*G2`. `STUDENT NO:` comes from the levels list, and the bank columns are left empty. |
| `src/read/` | Reads the uploaded files. `register.ts` reads the Word register. `debrief.ts` reads only the debrief's date, name, module, level and time columns. `levels-list.ts` reads only the SI list's name, student number and level columns, never "Contact". Rows it can't read with certainty are flagged, never guessed. |
| `tests/` | Automated checks for every rule, including the edge cases. The reading tests use made-up documents only. |
| `src/core/commands.ts`, `src/core/editor.ts` | The claim form editor: reads typed commands, changes the lines, and works the totals out again. |
| `scripts/demo.ts` | A made-up SI Leader's month, worked through step by step. |
| `scripts/edit-claim.ts` | Try the editor on a submitted form's lines. It prints the form before and after; it doesn't change the PDF yet. |
| `scripts/compare-register.ts` | Compares, per SI Leader, the SI session hours the rules give from the register with the hours on their submitted form. Also checks the rate from their debrief level against the rate on their form, and lists days that are in the register but not the debrief, and the reverse. |

Real data (exports, submitted forms, generated PDFs) is never stored in this
folder or on GitHub. It stays in OneDrive. The `.gitignore` file blocks
spreadsheets, Word documents and PDFs from being saved here by accident.

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

6. **See filled claim forms.** This fills the HRM-05 for made-up people and saves them in the `local-data` folder. Open them in your usual PDF reader.
   - `EXAMPLE AB.pdf` is the demo month.
   - `EXAMPLE CD.pdf` has 15 lines, so its four classes at the same time are combined into 2 lines (3 classes, then 1), and it fits on one form.
   - `EXAMPLE EF.pdf` and `EXAMPLE EF (form 2).pdf` have 15 sessions at different times. Nothing can be combined, so the claim continues on a second form.
   - `EXAMPLE control list.xlsx` is the control list for these three. Click a TOTAL AMOUNT cell to see its formula.

    To try a different blank form, put its path after `--`, e.g. `npm run demo:pdf -- "C:\path\to\form.pdf"`:

   ```
   npm run demo:pdf
   ```

7. **Try the website.** Start it, then open <http://localhost:5173> in your browser. Leave PowerShell open while you use it, and press Ctrl+C there to stop it.

   ```
   npm run dev
   ```

   Until the class attendance and levels list can be read:
   - Under "Blank HRM-05 claim form", click **Use the test copy** (or upload your blank form).
   - Click **Try it with made-up data**, then **Make the claim forms**.
   - The summary, the checks and all the downloads work as they will with real files.

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
11. The form has 13 lines. With more lines, class lines with the same times are combined first, up to 3 to a line (`10&14&17/09/2026`). Then, if needed, SI session lines with the same times are combined, up to 2 to a line. Only then does a second form follow. Anything beyond two forms is flagged for your decision.
