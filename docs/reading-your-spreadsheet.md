# Reading your spreadsheet

You've run the parser and opened `training_log.xlsx`. This page walks
through each sheet, what it contains, and what you can do with it.

A fully-populated synthetic example lives at
[docs/examples/demo_training_log.xlsx](examples/demo_training_log.xlsx) —
open that alongside this page if you don't have your own capture yet.

---

## Summary

The cover page. Shows:

- Generated-at timestamp (when you ran the parser)
- Captured-at timestamp (when the browser scraper ran)
- Source (`app.mystrengthbook.com`)
- Date range covered
- Totals: training days, sets, unique exercises
- A colour legend explaining the row shading in the Raw Log

Use this sheet to confirm the capture grabbed what you expected before
digging into the rest.

---

## Raw Log

The flat source of truth. **One row per set** across your whole
history. 14 columns:

| Column | Meaning |
|---|---|
| Date | YYYY-MM-DD of the training day |
| Day | Mon / Tue / Wed ... |
| Order | A / B / C — the exercise's position in the day |
| Exercise | Exercise name as MSB stored it |
| Set # | Which set within that exercise (1, 2, 3, ...) |
| Target (Prescribed) | The coach's plan for the set, e.g. `3x5 @ 80%` |
| Status | `completed` / `partial` / `missed` / `prescribed only` |
| Reps | Actual reps you performed |
| RPE | Actual RPE you logged |
| Load | Actual load you lifted, in kg (or lbs with `--units lbs`) |
| %1RM | MSB-computed percentage of your 1RM for that set |
| e1RM | Estimated 1RM from reps + load + RPE |
| Comment | Your per-set comment, **in full** (not MSB's 40-char preview) |
| Source | `full_detail` or `calendar_only` |

Rows from days where the parser had full detail (v4 always does) are
shaded green.

**What to do with it:**

- **Filter by exercise** — click the arrow on the `Exercise` header,
  pick one, see every set you've ever done of that lift.
- **Build a pivot table** — Data → PivotTable. Drag `Exercise` to
  Rows, `Date` to Columns, `Load` to Values with `MAX`. You've just
  built a top-load-per-session matrix.
- **Filter by comment** — type a keyword in the Comment header filter
  to find every set where you wrote "elbows" or "form breakdown" or
  whatever.

---

## Week YYYY-MM-DD sheets (one per training week)

The hero sheets. Formatted like the classic
Jeff Nippard / Peace Era / PPL coaching spreadsheet. Each day of the
week is a block with columns:

`Exercise | Sets | Reps | RPE | Set 1 | Set 2 | Set 3 | Set 4 | Set 5 | LSRPE | Notes`

If you hit fewer reps than prescribed, the load cell is annotated
(`"70 kg x 5"` means "70 kg for 5 reps, which is less than the
prescribed rep count"). Comments are concatenated into the Notes
column.

**What to do with them:**

- **Screenshot a week** and send it to your coach.
- **Copy-paste into Google Sheets** as a lightweight shareable view.
- **Compare week-over-week** by having two sheets open side by side.

---

## Exercise Progress

One row per `(exercise, training day)`. The columns track the top
working-set numbers for that session:

- Top load of the session
- Top reps at that top load
- Top RPE
- Best e1RM of the session (highest across all sets that day)
- Total set count you did on that exercise that day

**What to do with it:**

- **Chart one exercise over time** — filter by exercise, select
  Date + e1RM columns, Insert → Line Chart. You've built a personal
  e1RM trend.
- **Spot plateaus** — scan the e1RM column for long flat stretches.
  Long flat = you may want a change in training stimulus.
- **See total volume per lift** — the set-count column summed gives
  you career touches on the exercise.

---

## e1RM Charts

Line charts of estimated 1RM over time, one per exercise with at
least five days of logged e1RM data. Arranged two charts per row.

**What to do with it:**

- **Glance at strength trajectory** for every main lift in one view.
- **Spot missed weeks** (gaps in the line).
- **Notice sudden drops** (usually a missed rep, a deload, or an
  intentionally light day — check the date against the Raw Log).

If an exercise has fewer than five e1RM data points, its chart is
omitted. That threshold is a guard against charts with too few
points to be meaningful.

---

## Exercise Index

Every exercise in your history, ranked by total volume. Columns:

| Column | Meaning |
|---|---|
| Exercise | Name |
| Total Sets | Across the full capture window |
| Training Days | Distinct days you did the exercise |
| First Seen | Earliest date in the capture |
| Last Seen | Most recent date |

**What to do with it:**

- **Audit your program** — sort by Total Sets. Are the lifts you
  *think* are your main lifts actually getting the most volume?
- **Catch typos** — two similar names that look like they should be
  the same lift? Use the `--rename-map` flag to merge them. See the
  README's "Exercise rename map" section.
- **Check exercise rotation** — look at First Seen / Last Seen to
  find lifts you've quietly stopped doing.

---

## Using the data outside Excel

- **Open in Google Sheets** — Drive → New → File upload → pick the
  xlsx. Most formatting survives; line charts may need a refresh.
- **Open in Numbers (Mac)** — double-click. Numbers converts the
  xlsx; save a copy back out if you want to keep the original.
- **Open in LibreOffice Calc** — double-click. Full compatibility.
- **Export to CSV** — Excel: File → Save As → `.csv` per sheet.
  LibreOffice can batch-export all sheets.
- **Feed into Pandas / R / Julia** — skip the xlsx entirely. Load
  `captures/msb_capture.json` directly. See `src/msb_extractor/models.py`
  for the domain shape if you want to reuse the parser's models.

---

## Regenerating the spreadsheet

Anytime you want a fresh xlsx from the same capture:

- **One-click:** double-click `run.bat` (Windows) or `run.sh`
  (Mac/Linux).
- **Command:** `python -m msb_extractor parse captures/msb_capture.json
  -o captures/training_log.xlsx`

Re-running is cheap (~1 second). Experiment with `--units lbs` or
`--rename-map rename.yaml` freely.
