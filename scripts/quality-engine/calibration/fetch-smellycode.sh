#!/usr/bin/env bash
# ─── SmellyCode++ Dataset Fetcher ─────────────────────────────────────────────
# Fetches the multi-smell-dataset-v1_2.csv from Figshare (CC0 license).
# This is an OPTIONAL local-only calibration asset — never committed to git.
#
# Usage:  bash scripts/quality-engine/calibration/fetch-smellycode.sh
# Output: scripts/quality-engine/calibration/data/multi-smell-dataset-v1_2.csv
#
# Dataset: Alomari et al. (2025) SmellyCode++.csv. figshare.
#   DOI: 10.6084/m9.figshare.28519385.v1
#   License: CC0 1.0 Universal
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"
TARGET="${DATA_DIR}/multi-smell-dataset-v1_2.csv"
DOWNLOAD_URL="https://ndownloader.figshare.com/files/52714583"
EXPECTED_MD5="902d4af8d1a52ef94666ecf620d7479d"

mkdir -p "${DATA_DIR}"

if [ -f "${TARGET}" ]; then
  COMPUTED=$(md5sum "${TARGET}" | cut -d' ' -f1)
  if [ "${COMPUTED}" = "${EXPECTED_MD5}" ]; then
    echo "[smellycode] Dataset already present and verified (${TARGET})"
    exit 0
  fi
  echo "[smellycode] MD5 mismatch — re-downloading."
fi

echo "[smellycode] Downloading SmellyCode++ dataset (~590 MB) from Figshare..."
curl -L --progress-bar -o "${TARGET}" "${DOWNLOAD_URL}"

COMPUTED=$(md5sum "${TARGET}" | cut -d' ' -f1)
if [ "${COMPUTED}" != "${EXPECTED_MD5}" ]; then
  echo "[smellycode] ERROR: MD5 mismatch — expected ${EXPECTED_MD5}, got ${COMPUTED}"
  echo "[smellycode] The download may be corrupted. Delete ${TARGET} and retry."
  exit 1
fi

echo "[smellycode] Download complete and verified (${TARGET})"