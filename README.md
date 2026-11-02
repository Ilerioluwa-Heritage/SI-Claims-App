# SI Claim Form Generator

Builds the monthly HRM-05 Student Assistance claim forms for the Supplemental
Instruction (SI) programme at the Centre for Academic Excellence, University of
Limpopo, from the SI Leaders' daily session register, the debrief form and the
lecturers' class attendance records.

## What you upload each month

Every run needs all three files. It won't start if any is missing.

1. **Daily session register.** The Word document (.docx), uploaded as it is. Session times come from here. Its weekly tables give the date (written once per day), SI Leader, module, time (e.g. `15h30-17h00`), platform, number of students and observer. A row's colour marks a cancelled session, no students, or not observed.
2. **Debrief form.** Download it from Google Sheets (File → Download → Microsoft Excel). The register and the debrief must agree, but the register wins:
   - A session in the register with no debrief is **still claimed**, and listed on a side note (SI Leader and dates).
   - A debrief with no session in the register is **not claimed**, but flagged, because a session might be missing from the register.

   The debrief also fills in missing register times. Its contact-details column is never read.
3. **Class attendance (lecturers' records).** Classes are taken only from what the lecturers recorded. The SI Leaders' own class records aren't used.

**Uploaded once: the list of SI Leaders and their levels.** The app keeps it. It sets each person's rate and is the list names are matched against. The debrief's "Level:" answers are only checked against it.

One program serves as both the website and the phone app. It's a web app that
can be installed on Android and iPhone from the browser, so both always give
identical results.

## Where things stand

| Stage | What | Status |
|---|---|---|
| 1 | Claim rules, reading the files, and checking against October 2026 | **In progress.** Rules, the register and debrief readers and the cross-check are done. Waiting for the lecturers' class attendance and the levels list. |
| 2 | Filling the HRM-05 PDF | Not started |
| 3 | Website: upload, checks, downloads, control list | Not started |
| 4 | Claim form editor (see below) | Not started |
| 5 | Installing on phones | Not started |
| 6 | Reading straight from Google Sheets | Set aside: you chose to always upload the three files (2 Nov 2026) |
| 7 | Putting it online | Not started |

### The claim form editor (planned, stage 4)

A section of the app for forms that need an administrator's judgement:

- Upload any HRM-05, filled or blank.
- Change it with typed commands, such as:
  - "add a session for the 12th that's 2hrs long that began at 18H00"
  - "remove the session of the 07th"
- See the change before it's applied.
- The total hours and amount are worked out again after every change, and you download the corrected form.

The app understands the commands itself, so nothing is sent to an AI service and the form's personal details stay on the device.

Adding a session applies the same rules as the generator (decided 3 Nov 2026). "2hrs that began at 18H00" is rounded and gets the 2h preparation added: 18H00–22H00, 4h. It also ends by 23H30, with any extra moved onto the start. If the change moves the SI Leader into a different data allowance band (e.g. 4 → 5 sessions), the editor says so and shows the command to add or remove that hour, rather than guessing which line it belongs on.

### Decisions still open (these affect what goes on the form)

1. **Data allowance with only one session.** Right now that session gets both hours.
2. **The 80-hour cap.** The total is capped, but which lines are reduced so the lines still add up to 80 hasn't been decided.
3. **Administrators' forms.** The total is fixed at 80 hours, but what goes on each line hasn't been decided.

### Decided

- **Class attendance (2 Nov 2026).** Classes come only from the lecturers' records, not the SI Leaders' own records. Each class line shows the lecturer's actual lecture time, not rounded (11H10–13H10).
- **Coloured register rows (2 Nov 2026).** Red (session cancelled) and green (students did not attend) rows are left out of the claim. Purple (not observed) and uncoloured rows are claimed. A colour the system doesn't know is flagged and not claimed. The colours can be changed in `src/core/settings.ts`.
- **Missing end times (2 Nov 2026).** If a register row has a start but no end time, the end time comes from that SI Leader's debrief for the same day and session. If the row has no time at all, both start and end come from the debrief. If there's no matching debrief, or it has no end time either, the row stays flagged and isn't claimed.
- **Register vs debrief (3 Nov 2026).** The register wins. A register session with no debrief is claimed and goes on the side note; a debrief with no register session isn't claimed and is flagged. A session counts as the same if it's the same SI Leader, the same day, and starts within 30 minutes.
- **Levels (3 Nov 2026).** They come from a list of SI Leaders and levels, uploaded once.
- **Uploads (2 Nov 2026).** All three files are uploaded for every run; nothing is read straight from Google.

## What's in this folder

| Folder / file | What it is |
|---|---|
| `src/core/` | **The claim rules, and the only place they live.** The website, the phone app and the tests all use these files. |
| `src/core/sources.ts` | The three files every run needs. |
| `src/core/settings.ts` | Rates, prep hours, data allowance bands, the cap, the 23H30 limit, the register's colours and column headings, and the fixed text on the form (G082, PROF O CHABAYA and so on). |
| `src/read/` | Reads the uploaded files. `register.ts` reads the Word register. `debrief.ts` reads only the debrief's date, name, module, level and time columns. Rows it can't read with certainty are flagged, never guessed. |
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
