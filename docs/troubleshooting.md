# Troubleshooting

Common problems and how to fix them. If yours is not listed, check the dev
server's terminal output: the lines starting with `[bids-physio]` show which
folders the server reads (`BIDS root`, `Physio root`, `Derivatives root`) and
how many physio files it found.

## The viewer shows no scans

The terminal says `No readable physio files under …`.

- Check that the folder named in that message holds the `sub-*` folders with
  the `*_physio.tsv.gz` files. That is `BIDS_ROOT`, or `BIDSPHYS_ROOT` when the
  physio is stored in a separate folder (see
  [Pointing the tool at the right folders](#pointing-the-tool-at-the-right-folders)).
- Check that the physio files are downloaded, not just listed. In a DataLad
  dataset, files that are not downloaded are broken symlinks. If you meant to explore/annotate the whole dataset, download them with:

  ```bash
  cd /path/to/dataset
  datalad get sub-*/ses-*/func/*_physio.*
  ```

  See [What to download](#what-to-download) for the other files the tool reads.

## Fewer scans on disk than the dataset lists

The on disk data summary (under the Annotations box) and the terminal line
`Physio files: X of Y downloaded` show how many recordings are on disk. If X is
smaller than Y, download the rest with `datalad get` (see
[What to download](#what-to-download)).

## What to download

The tool only needs small text files: the physio recordings, their sidecars
and a few tables. You never need the `*.nii.gz` images. What to download
depends on which folder each file is read from (see
[Pointing the tool at the right folders](#pointing-the-tool-at-the-right-folders)).
Run the commands below from the dataset's top folder. For a dataset without
sessions, use `sub-*/func/` in place of `sub-*/ses-*/func/`. When the physio
or derivatives sit next to the main BIDS folder (e.g. CNeuroMod's `data/`,
`physprep/` and `fmriprep/`), run each group of commands in the folder it
belongs to, without the `derivatives/fmriprep/` prefix.

| Folder | Files | Needed for |
|---|---|---|
| Physio folder (`BIDS_ROOT`, or `BIDSPHYS_ROOT`) | `*_physio.tsv.gz` and `*_physio.json` | The recordings and their sampling rate, start time and channel names |
| Main BIDS folder (`BIDS_ROOT`) | `dataset_description.json`, `participants.tsv`, `participants.json` | Dataset info box; participant variables (age, sex, …) in the scatter plot and Stats |
| Main BIDS folder (`BIDS_ROOT`) | `*_bold.json` and top-level `task-*_bold.json` | `RepetitionTime` / `VolumeTiming`: the trigger check and the confounds time axis |
| Main BIDS folder (`BIDS_ROOT`) | `*_events.tsv` and top-level `task-*_events.tsv` | The events chart for task scans |
| Derivatives folder (`BIDSDER_ROOT`) | `*_desc-confounds_timeseries.tsv` (fMRIPrep) or `*_timeseries.tsv` (MRIQC), and `dataset_description.json` | The confounds chart and the derivatives' pipeline and version |
| Derivatives folder (`BIDSDER_ROOT`) | `*_bold.json` | Fallback BOLD timing when the main folder has none |

**Physio** (in the main BIDS folder, or the separate physio folder):

```bash
datalad get sub-*/ses-*/func/*_physio.*
```

**Main BIDS folder.** The BOLD sidecars carry the timing used for the trigger
check, so the scan's timing badge stays "sidecar only" without them:

```bash
datalad get dataset_description.json participants.* task-*_bold.json task-*_events.tsv
datalad get sub-*/ses-*/func/*_bold.json sub-*/ses-*/func/*_events.tsv
```

**Derivatives.** If the derivatives folder is a DataLad subdataset that is not
installed yet (an empty folder), install it without content first:

```bash
datalad get -n derivatives/fmriprep
datalad get derivatives/fmriprep/dataset_description.json
datalad get derivatives/fmriprep/sub-*/ses-*/func/*_desc-confounds_timeseries.*
datalad get derivatives/fmriprep/sub-*/ses-*/func/*_bold.json
```

For MRIQC, use `derivatives/mriqc/sub-*/ses-*/func/*_timeseries.*` instead of
the confounds line.

Files that are kept in git rather than git-annex (often `dataset_description.json`
and `participants.tsv`) are already there after `datalad install`.
`datalad get` reports them as already present, which is fine. A pattern that
matches nothing gives an error: skip that line, the dataset simply has no such
files.

After downloading, restart the dev server (it counts the files when it starts)
and rerun `scripts/compute-quality-metrics.ts`.

## Signal quality metrics are missing

The Stats tab and the scatter plot only appear once the metrics have been
computed, and the metrics are not updated by themselves when you download more
data. If the Stats tab is missing, or covers fewer scans than are on disk,
rerun:

```bash
npx vite-node scripts/compute-quality-metrics.ts <dataset>
```

then reload the page. The Stats tab shows when the metrics were last computed
and for how many scans, e.g. "78 of 120 scans (40 not downloaded, 2 failed)".

If the numbers still don't match, the missing scans are possibly not downloaded
yet: download them first, then rerun the script.

## Pointing the tool at the right folders

| Setting | Point it at | Used for |
|---|---|---|
| `BIDS_ROOT` | Always the main BIDS folder, even when the physio is stored elsewhere | `dataset_description.json`, `participants.tsv`, task events, BOLD sidecars |
| `BIDSPHYS_ROOT` | The folder holding the physio files, when it is outside `BIDS_ROOT` | Physio files and their sidecars; the list of subjects, sessions, tasks and runs |
| `BIDSDER_ROOT` | The derivatives pipeline folder with the confounds, when it is outside `BIDS_ROOT/derivatives/` | Confounds (fMRIPrep or MRIQC), the derivatives' dataset description |
| `ANNOTATIONS_ROOT` | Any writable folder (default `data/annotations/`) | Where annotations are saved |
| `DATASET_NAME` | A short name | Which `data/quality/<name>/` folder Stats reads, for datasets outside `data/` |

Physio files normally live in the main BIDS folder and derivatives in its
`derivatives/` folder, so `BIDS_ROOT` is usually enough:

```bash
BIDS_ROOT=/path/to/dataset npm run dev
```

When `BIDSPHYS_ROOT` and `BIDSDER_ROOT` are not set, the server looks for them
inside `BIDS_ROOT` by their files, never by folder name:

- **Physio:** the main folder when its `sub-*/[ses-*/]func/` folders have
  `*_physio.tsv.gz` files; otherwise the first folder inside it, or inside its
  `derivatives/`, that has them.
- **Derivatives:** the folder inside `derivatives/` with confounds files,
  preferring fMRIPrep's over MRIQC's.

The terminal prints the three folders and how each was chosen. When more than
one folder matches, it names the others: set the variable to pick one.

**Physio or derivatives stored next to the main BIDS folder.** These are not
searched for: give all three. For example, CNeuroMod `friends` keeps the main
BIDS folder (with `dataset_description.json`, `participants.tsv` and the
`sub-*` folders) in `data/`, next to `physprep/` and `fmriprep/`:

```bash
BIDS_ROOT=data/friends/friends BIDSPHYS_ROOT=data/friends/physprep BIDSDER_ROOT=data/friends/fmriprep npm run dev
```

Only the physio files are read from `BIDSPHYS_ROOT`. The dataset description,
participants, events and BOLD sidecars always come from `BIDS_ROOT`, so point
it at the main BIDS folder even when the physio is elsewhere.

## Computing the quality metrics

Give the script the same folders as the dev server: `--bids-root`,
`--physio-root` and `--deriv-root` match `BIDS_ROOT`, `BIDSPHYS_ROOT` and
`BIDSDER_ROOT`. The first argument is the dataset name, which picks the output
folder `data/quality/<name>/`.

```bash
# Main BIDS folder is data/<name>, physio and derivatives inside it
npx vite-node scripts/compute-quality-metrics.ts ds006644

# Physio and derivatives stored next to the main BIDS folder (CNeuroMod): give all three
npx vite-node scripts/compute-quality-metrics.ts friends --bids-root data/friends/friends --physio-root data/friends/physprep --deriv-root data/friends/fmriprep
```

Without `--bids-root`, the script uses `data/<name>` as the main BIDS folder.
For friends that is `data/friends`, which only holds other folders, so it
would find no dataset description, participants or BOLD sidecars.

The script prints the three folders it uses before it starts. Check them if
it reports `0 readable scans`.

Use the same name the dev server uses, so the Stats tab finds the metrics:
the first folder under `data/` (`data/friends/friends` → `friends`), or
`DATASET_NAME` for a dataset outside `data/`.

## The main BIDS folder's dataset description is missing

The header and the terminal say `The main BIDS folder's dataset description
was not found at …`. The dataset name, authors, licence and DOI come from
`dataset_description.json` in `BIDS_ROOT`, and the file is not there: the
folder is not installed yet (an empty DataLad subdataset), the file is not
downloaded, or `BIDS_ROOT` points at the wrong folder.

- Until it is fixed, the header shows the title from the physio folder's
  description, else the derivatives', and says which one. That is the
  pipeline's description, not the dataset's own.
- When the folder above `BIDS_ROOT` is a DataLad dataset that lists it as a
  subdataset, the message gives its link and the command that installs it,
  e.g. `cd data/friends && datalad get -n data && datalad get data/dataset_description.json`.
  Otherwise it links to the source dataset named in the physio or derivatives
  description (`SourceDatasets`), when there is one.
- Computing the metrics still works without it: the physio metrics are
  computed, and the script prints the same warning. Dataset info,
  participants and BOLD timing stay empty until the main folder is there, so
  rerun the script afterwards.

## No dataset title or authors found

The header and the terminal say `No dataset title (or authors) found in …`.
The named `dataset_description.json` has no `"Name"` or `"Authors"`, or only
placeholders: empty values, values without letters, `n/a`, `unknown`,
`unspecified`, `TODO`, `TBD`, `Author 1` and similar. Placeholders are left
out of the header, the Stats tab and the PDF report. Add the real values to
that file, for example:

```json
{
  "Name": "My study",
  "Authors": ["Jane Doe", "John Smith"]
}
```

then restart the dev server and rerun the compute script.

## The confounds chart shows approximate timing

Confounds are placed on the time axis using the BOLD sidecar's
`RepetitionTime` or `VolumeTiming`, read from `BIDS_ROOT` and then from
`BIDSDER_ROOT`. BOLD sidecars in a separate physio folder are not read. If
neither folder has one, volumes are spread evenly across the recording, which
is only approximate. Check that `BIDS_ROOT` is the main BIDS folder.

## No Confound dropdown

The dropdown only appears when the scan has a confounds file under
`BIDSDER_ROOT`. Check that the folder is right and that the
`*_desc-confounds_timeseries.tsv` files are downloaded.

## The PDF report is missing

`quality_report.pdf` is not made by the compute script. The app builds it in
the background the first time you open the Stats tab after computing the
metrics, and saves it under `data/quality/<dataset>/`. The Stats sidebar shows
its progress. Rerunning the script deletes the old report.

## Search finds nothing

The search bar takes subject or session labels only, not file names:

- `sub-03` or `03` jumps to subject 03.
- `ses-02` jumps to session 02 of the current subject.

Labels must match exactly, including leading zeros: `sub-3` does not find
`sub-03`.
