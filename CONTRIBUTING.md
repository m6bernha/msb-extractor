# Contributing to msb-extractor

Thanks for helping out. This is a small project built by one person to
solve one problem, but bug reports, patches, and new exporter formats are
all welcome.

## Ground rules

- **Be kind to MSB.** This tool should not be used to hammer
  MyStrengthBook's servers, scrape other people's accounts, or work around
  rate limits in any aggressive way. The default scraper pacing is
  deliberately slow; keep it that way.
- **Be kind to other users' data.** Do not check in real capture JSONs,
  real spreadsheets, or anything containing identifiable training
  comments. Fixtures should be synthetic.
- **Keep the tool offline.** Nothing in this repo is allowed to send user
  data to a third-party service, including analytics, error reporting, or
  AI back-ends. No exceptions.

## Dev setup

```bash
git clone https://github.com/matthiasbernhard/msb-extractor.git
cd msb-extractor
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

## Running the checks

All of these must be green before a PR can merge. CI runs the same set on
push.

```bash
ruff check .
ruff format --check .
mypy
pytest
```

## Commit style

Conventional commits, roughly. The types that show up most often:

- `feat(scope): ...` — user-visible feature
- `fix(scope): ...` — user-visible bug fix
- `refactor(scope): ...` — no behaviour change
- `docs: ...` — documentation only
- `chore: ...` — tooling, deps, lint config
- `test: ...` — tests only

Scope is usually one of `parser`, `export`, `cli`, `scraper`, `normalize`,
or left off for repo-wide changes.

Commit messages explain **why**, not just **what**. "fix parser crash on
empty month" is fine; "fix parser crash on empty month — MSB returns an
empty calendar page for months with no training, which used to fail the
regex sweep" is better.

## Adding a new exporter

Exporters live under `src/msb_extractor/export/`. They receive a fully
parsed `ParseResult` and write to disk. The pattern is:

1. Add a new module named `<format>.py` (or `_<sheet>.py` if it's a new
   sheet in the xlsx orchestrator).
2. Write the module's public entry function that takes the `ParseResult`
   and an output path.
3. Hook it up in `export/xlsx.py` (for new xlsx sheets) or in a new CLI
   subcommand in `cli.py` (for entirely new output formats).
4. Add tests under `tests/` using the fixture-based
   `capture_json` / `capture_file` fixtures already in `conftest.py`.

## Adding parser coverage for edge cases

If you've found a training-day layout or prescription string that the
parser mishandles:

1. Reproduce the issue on a tiny HTML snippet and add it to
   `tests/fixtures/` as a new `.html` file.
2. Write a failing test in the appropriate `tests/test_parser_*.py`
   referring to that fixture.
3. Fix the parser and confirm the test turns green.

Do not check in the real MSB HTML that exposed the bug. Always reproduce
with synthetic HTML.

## Release checklist

(For maintainers pushing a new version.)

- [ ] `pyproject.toml` version bumped
- [ ] `CHANGELOG.md` entry written (if we ever add one)
- [ ] Tag created: `git tag -a v0.x.y -m "release v0.x.y"`
- [ ] PyPI upload (if publishing): `python -m build && twine upload dist/*`
