# Privacy

`msb-extractor` is an offline tool. This page explains exactly where your
data lives and who it touches.

## Data flow

```
  your browser              your disk                  your choice
  +------------+            +--------------+           +-----------+
  |  MSB page  |  fetch()   |  msb_capture |  parse    |  xlsx     |
  |  (authed)  | ---------> |   .json      | --------> |  output   |
  +------------+  HTTPS     +--------------+           +-----------+
                  same-origin
```

1. **In the browser.** The scraper issues same-origin `fetch()` calls to
   `https://app.mystrengthbook.com/dashboard/...`. These are exactly the
   requests your browser would make if you clicked through the site
   yourself. Your MSB session cookies go along with them, because they
   are your cookies in your own tab.

2. **On disk.** The scraper calls `a.click()` on an in-memory Blob URL,
   which triggers the browser's standard "save file" flow. The captured
   JSON lands in your default downloads folder.

3. **In the CLI.** `msb-extractor parse` reads the JSON from disk, parses
   it with BeautifulSoup and lxml (both pure-Python, offline libraries),
   and writes an xlsx with openpyxl (also pure-Python, offline).

At no point does anything in this repo open a network connection to any
host other than `app.mystrengthbook.com`. There is no analytics
collector. There is no error reporter. There is no AI back-end. There is
no auto-update check. There is no bug-report phone-home.

## What data the scraper sees

Everything your logged-in account can see on the calendar and day-detail
pages. That is:

- Your own training data (dates, exercises, prescribed sets, actual
  sets, comments, videos, estimated 1RMs)
- Your training program template
- Your coach's name, if it appears on any of the pages
- Any other HTML your account happens to render on those pages

The captured JSON contains the **raw HTML** of the pages. That is more
than the final xlsx exposes. Treat the JSON like you would treat a
database dump of your own account: keep it somewhere you are comfortable
keeping training data.

## What the scraper deliberately avoids

- It never submits forms, changes settings, adds workouts, or modifies
  any state on the MSB side.
- It never reads the browser's cookie jar directly. It just relies on
  the browser's normal same-origin behaviour.
- It does not try to bypass any authentication. If you are logged out,
  the requests simply 401 and the script stops.

## Dependencies the CLI pulls in

All released on PyPI under permissive open-source licences. None of them
perform network I/O at runtime when used the way `msb-extractor` uses
them.

- [beautifulsoup4](https://pypi.org/project/beautifulsoup4/) — HTML parsing
- [lxml](https://pypi.org/project/lxml/) — parser back-end for BS4
- [pydantic](https://pypi.org/project/pydantic/) — typed domain models
- [openpyxl](https://pypi.org/project/openpyxl/) — xlsx writer
- [typer](https://pypi.org/project/typer/) — CLI framework
- [rich](https://pypi.org/project/rich/) — terminal output
- [pyyaml](https://pypi.org/project/pyyaml/) — rename-map config loader

## Deleting your data

There is nothing to delete on any server. Delete `msb_capture.json` from
your downloads folder and any xlsx files `msb-extractor parse` produced,
and the data is gone.
