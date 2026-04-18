# Example output

This folder contains a synthetic example of what `msb-extractor` produces.
The data is made up, but it uses the same parser and exporter the tool would
run against a real MyStrengthBook capture.

| File | What it is |
|---|---|
| `demo_training_log.xlsx` | A 4-week Push / Pull / Legs block rendered through the full export pipeline. Open it in Excel / Numbers / LibreOffice to preview the sheet layout, the weekly banners, the Exercise Progress columns, and the e1RM line charts. |
| `generate_demo.py`  | The one-file Python script that produced the xlsx. Re-run it any time with `python docs/examples/generate_demo.py` to regenerate the demo. |

## What the demo contains

- 12 training days across 4 calendar weeks (Mon / Wed / Fri split)
- 12 exercises (Bench / OHP / Deadlift / Squat / RDL / rows / etc.)
- Realistic weekly progression, per-set RPE drift, an intentional missed
  rep in week 3, a handful of per-set comments
- Every output sheet populated: Raw Log, Week 2026-03-02 through
  Week 2026-03-23, Exercise Progress, Exercise Index, Summary, and the
  e1RM Charts sheet with one line chart per primary lift
