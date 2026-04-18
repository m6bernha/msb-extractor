# Terms of use

`msb-extractor` is an unofficial tool. This document spells out the terms
under which it is released and the constraints on how you should use it.
It is distinct from the software licence (MIT, see [LICENSE](../LICENSE)),
which governs your rights to the code itself.

## 1. Not affiliated with MyStrengthBook

This project is not produced by, endorsed by, or affiliated with
MyStrengthBook Inc., any of its coaching partners, or any reskinned
"Training App" white-label built on top of their platform. All
MyStrengthBook trademarks, service marks, and brand elements belong to
their respective owners and are referenced here only for the purpose of
identifying the platform the tool interacts with.

## 2. Intended use

The tool is intended for the extraction of **a user's own** training data
from **their own** MyStrengthBook account, to a spreadsheet the user
controls.

Intended use cases:

- Backing up your own training history against service disruption
- Analyzing your own training patterns in a spreadsheet or data tool of
  your choice
- Sharing your own spreadsheet with a coach, training partner, or
  analyst you have chosen to share with
- Migrating your own training history to another logging platform

## 3. Unacceptable use

You agree not to use this tool to:

- Access, download, or process data from any MyStrengthBook account you
  do not own, or an account you do not have the account-holder's clear
  consent to extract data from
- Circumvent any security control, rate limit, or access restriction
  beyond what this tool does by default (which is: re-use your own
  already-logged-in session to read pages your own account can already
  see)
- Redistribute the raw or processed data of third parties without their
  consent, including but not limited to coaches publishing the training
  logs of athletes under their care
- Interact with MyStrengthBook's systems in ways inconsistent with their
  own published Terms of Service at the time of use

## 4. Coaches and multi-athlete accounts

If you are logged in to a coach-tier account that has visibility over
multiple athletes, treat each athlete's data as the athlete's, not as
yours. Obtain permission before extracting it, do not archive it beyond
what is agreed, and do not publish identifiable captures or
spreadsheets.

## 5. No warranty

This software is provided "as is", without warranty of any kind, express
or implied, including but not limited to the warranties of
merchantability, fitness for a particular purpose, and non-infringement.

The authors make no guarantees that:

- The tool will continue to work. MyStrengthBook can and may change
  their HTML structure, authentication flow, or rate limits at any
  time, which may break the scraper or parser without notice.
- The captured data is complete or accurate. Server-side failures
  (502s, 500s, transient blank pages) can cause captures to miss
  individual dates, and parsing heuristics may misinterpret unusual
  coach-authored prescriptions.
- The tool is secure against future classes of bugs we have not yet
  thought of.

## 6. If you are MyStrengthBook

If you are a representative of MyStrengthBook and you would prefer this
tool not exist, please open an issue on the project's GitHub and we will
discuss it. The maintainer would rather work with you than around you.

---

These terms are not a contract. They are the social expectations under
which the tool is shared. Abide by them.
