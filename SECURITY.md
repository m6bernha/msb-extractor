# Security policy

`msb-extractor` is a local-first tool: the browser scraper only talks to
`app.mystrengthbook.com` on the tab you already have open, and the Python
CLI has zero network code. That said, this project does handle
auth-adjacent data (a short-lived JWT lifted from MSB's own SPA while the
scraper runs) and parses attacker-influenceable inputs (capture JSON,
exercise rename-map YAML). Vulnerabilities that weaken those properties
matter.

## Reporting a vulnerability

Please **do not open a public issue** for a security-sensitive report.

- Preferred: use GitHub's private vulnerability reporting — open the
  [Security tab on the repo][gh-security] and click
  *"Report a vulnerability"*.
- Alternative: email the maintainer listed in `pyproject.toml`.

Include:

- A short description of the issue and the impact you think it has.
- Reproduction steps or a minimal capture JSON / payload if applicable.
- The commit hash (or version tag) you tested against.

The maintainer will acknowledge the report within **7 days** and aim to
ship a fix or a public advisory within **30 days** for confirmed issues.
If the issue is urgent and 30 days is too long, say so — the timeline is
a default, not a ceiling.

## In scope

- The browser scraper in [scraper/](scraper/): anything that could leak
  the captured JWT, `userId`, or full training payload to a third party,
  or that lets MSB's page scripts read the capture after download.
- The Python CLI and parsers in [src/msb_extractor/](src/msb_extractor/):
  anything that lets a malicious `msb_capture.json` or rename-map YAML
  execute code, traverse the filesystem, or crash the interpreter in a
  way that loses data.
- The installation path documented in the README (`pip install -e .`).
  Supply-chain issues in direct dependencies are worth reporting even if
  they are not yet exploited through this package.

## Out of scope

- Findings that require full local code execution to reproduce (e.g.
  "if an attacker can already write to your home directory...").
- Exhaustion DoS on the Python CLI with captures larger than a user
  would ever realistically produce.
- Issues in the upstream `app.mystrengthbook.com` platform itself — we
  can't fix those; please report them to MyStrengthBook directly.

## What this tool promises

- The scraper only issues requests to `app.mystrengthbook.com`. See
  [docs/privacy.md](docs/privacy.md) for the data flow.
- The captured JSON never leaves your machine unless you share it
  explicitly.
- No telemetry, no analytics, no accounts.

If you find behaviour that contradicts these promises, that is a
security issue — please report it.

[gh-security]: https://github.com/m6bernha/msb-extractor/security/advisories/new
