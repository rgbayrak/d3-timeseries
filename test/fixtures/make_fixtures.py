#!/usr/bin/env python3
"""Generate the tiny synthetic BIDS datasets used by the test suites.

Run from the repository root:

    python3 test/fixtures/make_fixtures.py

Output is deterministic (fixed signals, gzip mtime = 0), so re-running it
produces byte-identical files and a clean `git diff`. Standard library only.

Two datasets are written next to this script:

bids-sessions/      sessions + runs, fMRIPrep-style derivatives
  sub-01 ses-01  clean triggers, scan-level BOLD sidecar  -> verified
  sub-01 ses-02  clean triggers, StartTime off by 0.5 s   -> corrected
  sub-02 ses-01  one dropped pulse; derivatives use run-1
                 (unpadded) with VolumeTiming             -> mismatch
  sub-02 ses-02  no trigger channel                       -> unverified
  sub-03 ses-01  physio is a broken symlink (un-fetched annex file) -> skipped

bids-nosessions/    no sessions, no runs
  sub-01  subject-level physio sidecar, header row in the TSV, top-level
          task-motor_bold.json, run-less quality sidecar  -> verified
  sub-02  top-level physio.json fallback, no trigger      -> unverified
"""

from __future__ import annotations

import gzip
import json
import math
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent

FS = 50.0           # physio sampling frequency (Hz)
TR = 2.0            # BOLD repetition time (s)
N_VOLUMES = 10
START_TIME = -2.0   # physio starts 2 s before the first volume (BIDS StartTime)
PULSE_S = 0.1       # trigger pulse width (s)
N_SAMPLES = int((N_VOLUMES * TR - START_TIME) * FS)  # 2 s lead-in + 20 s scan


# ---------------------------------------------------------------- writers

def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n")


def write_gz(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
        gz.write(text.encode("utf-8"))


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


# ---------------------------------------------------------------- signals

def trigger_onsets(shift_s: float = 0.0, drop: int | None = None) -> list[float]:
    """Volume onset times on the true scan axis, optionally shifted or with one pulse dropped."""
    onsets = [k * TR + shift_s for k in range(N_VOLUMES)]
    if drop is not None:
        del onsets[drop]
    return onsets


def physio_rows(onsets: list[float] | None) -> list[list[str]]:
    """cardiac (1.2 Hz), respiratory (0.25 Hz) and, if onsets is given, a 0/1 trigger."""
    width = round(PULSE_S * FS)
    starts = {round((t - START_TIME) * FS) for t in onsets} if onsets is not None else set()
    high = {s + j for s in starts for j in range(width)}
    rows = []
    for i in range(N_SAMPLES):
        t = START_TIME + i / FS
        row = [
            f"{math.sin(2 * math.pi * 1.2 * t):.4f}",
            f"{0.5 * math.sin(2 * math.pi * 0.25 * t):.4f}",
        ]
        if onsets is not None:
            row.append("1" if i in high else "0")
        rows.append(row)
    return rows


def physio_tsv(onsets: list[float] | None, header: bool = False) -> str:
    cols = ["cardiac", "respiratory"] + (["trigger"] if onsets is not None else [])
    lines = (["\t".join(cols)] if header else []) + ["\t".join(r) for r in physio_rows(onsets)]
    return "\n".join(lines) + "\n"


def physio_sidecar(with_trigger: bool, start_time: float = START_TIME) -> dict:
    cols = ["cardiac", "respiratory"] + (["trigger"] if with_trigger else [])
    return {"SamplingFrequency": FS, "StartTime": start_time, "Columns": cols}


def confounds_tsv() -> str:
    """fMRIPrep-style confounds: motion columns plus one non-motion column; FD starts with n/a."""
    header = ["global_signal", "framewise_displacement", "trans_x", "rot_x"]
    lines = ["\t".join(header)]
    for k in range(N_VOLUMES):
        fd = "n/a" if k == 0 else f"{0.05 * k:.3f}"
        lines.append("\t".join([f"{100 + k:.1f}", fd, f"{0.01 * k:.3f}", f"{0.001 * k:.4f}"]))
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- datasets

def make_sessions(root: Path) -> None:
    der = root / "derivatives" / "fmriprep"
    write_json(root / "dataset_description.json", {
        "Name": "Synthetic physio fixture (sessions)",
        "BIDSVersion": "1.9.0",
        "DatasetType": "raw",
        "License": "CC0",
        "Authors": ["Fixture Author"],
        "DatasetDOI": "doi:10.0000/fixture.sessions",
    })
    write_json(der / "dataset_description.json", {
        "Name": "fMRIPrep outputs",
        "BIDSVersion": "1.9.0",
        "DatasetType": "derivative",
        "GeneratedBy": [{"Name": "fMRIPrep", "Version": "23.0.2"}],
    })

    # (sub, ses, trigger onsets on the sidecar axis or None, derivatives run label, BOLD timing source)
    scans = [
        ("01", "01", trigger_onsets(), "01", "raw"),
        ("01", "02", trigger_onsets(shift_s=0.5), "01", "raw"),
        ("02", "01", trigger_onsets(drop=4), "1", "derivatives"),
        ("02", "02", None, "01", "raw"),
    ]
    for sub, ses, onsets, der_run, bold_src in scans:
        func = root / f"sub-{sub}" / f"ses-{ses}" / "func"
        prefix = f"sub-{sub}_ses-{ses}_task-rest_run-01"
        write_gz(func / f"{prefix}_physio.tsv.gz", physio_tsv(onsets))
        write_json(func / f"{prefix}_physio.json", physio_sidecar(onsets is not None))

        der_func = der / f"sub-{sub}" / f"ses-{ses}" / "func"
        der_prefix = f"sub-{sub}_ses-{ses}_task-rest_run-{der_run}"
        write_text(der_func / f"{der_prefix}_desc-confounds_timeseries.tsv", confounds_tsv())
        if bold_src == "raw":
            write_json(func / f"{prefix}_bold.json", {"RepetitionTime": TR, "TaskName": "rest"})
        else:
            write_json(der_func / f"{der_prefix}_space-MNI152NLin2009cAsym_desc-preproc_bold.json", {
                "VolumeTiming": [k * TR for k in range(N_VOLUMES)],
                "TaskName": "rest",
            })

    # Run-level quality sidecar for sub-01 ses-01
    # PercentageValid is a fraction (0-1, one decimal), as in physprep outputs
    write_json(root / "sub-01" / "ses-01" / "func" / "sub-01_ses-01_task-rest_run-01_desc-quality.json", {
        "Description": "Per-channel quality",
        "cardiac": {"QualityAssessment": "Pass", "PercentageValid": 1.0},
        "respiratory": {"QualityAssessment": "Pass", "PercentageValid": 0.9},
    })

    # sub-03: physio is a dangling symlink, like a DataLad file that was never fetched
    func3 = root / "sub-03" / "ses-01" / "func"
    func3.mkdir(parents=True, exist_ok=True)
    link = func3 / "sub-03_ses-01_task-rest_run-01_physio.tsv.gz"
    os.symlink("../../../.git/annex/objects/not-fetched", link)
    write_json(func3 / "sub-03_ses-01_task-rest_run-01_physio.json", physio_sidecar(True))


def make_nosessions(root: Path) -> None:
    write_json(root / "dataset_description.json", {
        "Name": "Synthetic physio fixture (no sessions)",
        "BIDSVersion": "1.9.0",
    })
    # Top-level BOLD inheritance for task-motor
    write_json(root / "task-motor_bold.json", {"RepetitionTime": TR, "TaskName": "motor"})
    # Top-level physio sidecar, used by sub-02 (no per-file or subject-level sidecar)
    write_json(root / "physio.json", physio_sidecar(False))

    # sub-01: subject-level sidecar, header row, triggers, run-less quality sidecar
    func1 = root / "sub-01" / "func"
    write_gz(func1 / "sub-01_task-motor_physio.tsv.gz", physio_tsv(trigger_onsets(), header=True))
    write_json(root / "sub-01" / "sub-01_task-motor_physio.json", physio_sidecar(True))
    write_json(func1 / "sub-01_task-motor_desc-quality.json", {
        "cardiac": {"QualityAssessment": "Pass", "PercentageValid": 1.0},
    })

    # sub-02: top-level physio.json, no trigger
    write_gz(root / "sub-02" / "func" / "sub-02_task-motor_physio.tsv.gz", physio_tsv(None))


def main() -> None:
    for name, build in [("bids-sessions", make_sessions), ("bids-nosessions", make_nosessions)]:
        root = HERE / name
        if root.exists():
            shutil.rmtree(root)
        build(root)
        print(f"wrote {root.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
