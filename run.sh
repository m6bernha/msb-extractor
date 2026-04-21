#!/usr/bin/env bash
# =====================================================================
#  MSB Extractor - one-click parse helper for macOS / Linux.
#
#  Usage:  bash run.sh     (or `./run.sh` after chmod +x run.sh)
#
#  It will:
#    1. Verify Python 3.11+ is installed.
#    2. Create a local virtual environment (.venv) if missing.
#    3. Install msb-extractor if not already installed.
#    4. Parse captures/msb_capture.json -> captures/training_log.xlsx.
#    5. Offer to open the spreadsheet (macOS only; on Linux it prints the path).
#
#  You still need to run the browser scraper first (see scraper/README.md)
#  and move the downloaded msb_capture.json into the captures/ folder.
# =====================================================================

set -euo pipefail
cd "$(dirname "$0")"

echo
echo "=== MSB Extractor - one-click parse ==="
echo

# --- 1. Python present? ----------------------------------------------
if command -v python3 >/dev/null 2>&1; then
    PY_CMD=python3
elif command -v python >/dev/null 2>&1; then
    PY_CMD=python
else
    echo "ERROR: Python is not installed or not on your PATH."
    echo
    echo "Install Python 3.11 or newer:"
    echo "  macOS:  brew install python@3.11  (or download from python.org)"
    echo "  Linux:  sudo apt install python3.11 python3.11-venv  (Debian/Ubuntu)"
    echo
    exit 1
fi

# --- 2. venv present? ------------------------------------------------
if [[ ! -x .venv/bin/python ]]; then
    echo "Creating Python virtual environment in .venv/ (one-time setup)..."
    "$PY_CMD" -m venv .venv
fi

PY=.venv/bin/python

# --- 3. package installed? -------------------------------------------
if ! "$PY" -c "import msb_extractor" >/dev/null 2>&1; then
    echo "Installing msb-extractor (first run, 30-60s)..."
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet -e .
fi

# --- 4. capture file present? ----------------------------------------
if [[ ! -f captures/msb_capture.json ]]; then
    echo
    echo "ERROR: No capture found at captures/msb_capture.json"
    echo
    echo "Before running this script:"
    echo "  1. Open app.mystrengthbook.com in your browser (logged in)."
    echo "  2. Paste scraper/msb-scraper.js into DevTools console (F12)."
    echo "  3. Click any day on the MSB calendar within 15 seconds."
    echo "  4. Move the downloaded msb_capture.json into the captures/ folder."
    echo "  5. Run this script again."
    echo
    exit 1
fi

# --- 5. parse --------------------------------------------------------
echo
echo "Parsing captures/msb_capture.json ..."
"$PY" -m msb_extractor parse captures/msb_capture.json -o captures/training_log.xlsx

# --- 6. offer to open ------------------------------------------------
echo
echo "Done. Output saved to: captures/training_log.xlsx"
echo

if command -v open >/dev/null 2>&1; then
    read -rp "Open the spreadsheet now? (y/n): " OPEN
    if [[ "$OPEN" == "y" || "$OPEN" == "Y" ]]; then
        open captures/training_log.xlsx
    fi
fi
