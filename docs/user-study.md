# physAI-QA-interactive: user study guide

**Duration:** about 50 minutes.

| Part | Content | 
|---|---|
| Intro | Consent, About you | 
| A | Load a dataset and start the pipeline | 
| B | Explore and annotate (scenario) | 
| C | Stats tab | 
| D | Questionnaires | 
| E | Open questions | 

**Setup.**

- Get a fresh copy of **ds006644** with its fMRIPrep derivatives in `data/ds006644` (step 2 below). Do **not** compute the quality metrics (skip step 3), and remove any `data/annotations/ds006644/` and `data/quality/ds006644/` left from earlier sessions.
- Start the tool (step 4), open it in the browser, and keep a terminal open in the project folder.

## Getting the data and starting the tool

Run these in a terminal in the project folder. The tool works with any dataset in [BIDS](https://bids.neuroimaging.io) format.

**1. Install** (once): `npm install`

**2. Get a dataset.** Either way, the dataset goes in its own folder under `data/` in the project folder (e.g. `data/ds006644`).

- **Download the study dataset (ds006644)** with DataLad, which fetches only the files the tool needs:

  ```bash
  brew install git-annex
  uv tool install datalad 
  datalad install -s https://github.com/OpenNeuroDatasets/ds006644.git data/ds006644
  cd data/ds006644
  datalad get sub-*/ses-*/func/*_physio.*
  datalad get derivatives/fmriprep/sub-*/ses-*/func/*_desc-confounds_timeseries.*
  cd ../..
  ```

- **Or add your own BIDS-compliant dataset:** copy (or link) it to `data/<name>/`. Any dataset in BIDS format works, as long as it has:
  - physiological recordings as `sub-XX/[ses-XX/]func/*_physio.tsv.gz`, each with a JSON sidecar giving `SamplingFrequency`, `StartTime` and `Columns`;
  - optionally fMRIPrep derivatives (`*_desc-confounds_timeseries.tsv`) to show head-motion confounds, by default in `derivatives/fmriprep/` inside the dataset.

  The dataset can also stay where it is: give the tool its path instead (step 4).

**3. Optional: compute the quality metrics first.** If you want the dataset-wide quality metrics to visualize (the scatter plot in Explore and Annotate, the Stats tab and the PDF report), run the script once for the dataset before starting the tool:

```bash
npx vite-node scripts/compute-quality-metrics.ts ds006644          # dataset folder name under data/
npx vite-node scripts/compute-quality-metrics.ts mydata --bids-root /path/to/bids --deriv-root /path/to/derivatives/fmriprep
```

It writes `data/quality/<name>/`. Without it, the tool still works for exploring and annotating; the scatter plot and the Stats tab only appear once the metrics exist. *In the study session, skip this step: task 2 runs it.*

**4. Start the tool:**

```bash
npm run dev                                                        # serves data/ds006644
BIDS_ROOT=data/mydata npm run dev                                  # another dataset under data/
BIDS_ROOT=/path/to/bids BIDSDER_ROOT=/path/to/derivatives/fmriprep npm run dev   # a dataset outside data/
```

`BIDS_ROOT` is the path to the BIDS root (the folder with `dataset_description.json`) and `BIDSDER_ROOT` the path to the derivatives (fMRIPrep) folder. Open the address it prints (usually `http://localhost:5173`). For a dataset outside `data/`, compute its metrics (step 3) with `--bids-root` and `--deriv-root`, and give the script the name of the `BIDS_ROOT` folder (e.g. `/path/to/mydata` → `mydata`), so the tool finds them. More options are in the README, under *Using your own dataset*.

**During the session**, fill in the **Done** column for each task:
**S** = completed alone, **H** = completed with facilitator help, **F** = failed or gave up, **–** = not reached.

**Participant.** Free explore for 5 mins. Then do each task, then rate how easy it was in the **Ease** column. Say out loud anything that confuses you.

**Ease scale (1-7):** *Overall, how difficult or easy was this task?*
1 = very difficult, 4 = neither, 7 = very easy.

## About you

| Question | Answer |
|---|---|
| Role (e.g. PhD student, postdoc, research engineer, PI) | |
| Years working with physiological recordings (cardiac, respiratory) | |
| Years working with fMRI or BIDS data | |
| Tools you currently use to check physiological data quality | |

## Part A: Load a dataset and start the pipeline (5 min)

| # | Do this | Done S/H/F/– | Ease 1-7 | Comments |
|---|---|---|---|---|
| 1 | In the browser, find which dataset the tool is showing and how many scans it found. | | | |
| 2 | In the terminal, run `npx vite-node scripts/compute-quality-metrics.ts ds006644` to compute the dataset's quality metrics. Leave it running and continue with Part B. | | | |

## Part B: Explore and annotate (18 min)

On the **Explore and Annotate** tab.

**Scenario.** You are checking the physiological recordings in this dataset before analysis. Work the way you normally would, and think aloud as you go.

| # | Do this | Done S/H/F/– | Ease 1-7 | Comments |
|---|---|---|---|---|
| 3 | **Browse.** Move through the scans, subject by subject, until you find one that has potential artifacts. Write down which scan it is: \_\_\_\_\_\_\_\_\_\_ | | | |
| 4 | **Inspect.** Look at that scan in detail. Zoom in, zoom out and scroll as needed until you can say what is wrong with it, and where. | | | |
| 5 | **Compare.** Check whether the problem is head motion (confound: framewise displacement or rot_x) for the same scan. How long is the time window with the issue? | | | |
| 6 | **Assess.** Is this scan's timing trustworthy? Does what you know about it support what you saw? | | | |
| 7 | **Annotate.** Rate the whole recording's signal quality and write a short note on why. Then mark the problem's time window with a label a colleague would understand. Replace that label with a more specific one. | | | |
| 8 | **Check.** Make sure your work was saved, and find where it is stored. How many scans of this channel are annotated so far? Reload the page: which scan does it open on, and why? | | | |
| 9 | **Known case.** Open **sub-18, session 02**. Is anything wrong with this scan's timing? How can you tell? | | | |

**Facilitator: controls used during tasks 3-8** (tick one per row). If no outlier has been picked after about 5 minutes, suggest one.

| Control | Used alone | Used after help | Not used |
|---|---|---|---|
| Next / Previous or arrow keys | | | |
| Search box or dropdowns | | | |
| Channel dropdown | | | |
| Zoom in (drag on the top chart) | | | |
| Zoom out (double-click) | | | |
| Move the window on the overview chart | | | |
| Window length shown over the overview | | | |
| Auxiliary Signal Options: Stack (extra channels) | | | |
| Auxiliary Signal Options: Confound (head motion) | | | |
| Timing badge (next to the file name) | | | |
| Signal Quality buttons (Good / Bad / Fixable / Unknown) | | | |
| Notes | | | |
| Annotate On / drag a time window / label | | | |
| Delete a time window (×) | | | |
| Annotated count and progress bar | | | |

## Part C: Scatter plot and Stats tab (10 min)

Check that the script from task 2 has finished, then reload the page: the scatter plot and the **Stats** tab appear once the metrics exist.

| # | Do this | Done S/H/F/– | Ease 1-7 | Comments |
|---|---|---|---|---|
| 10 | Find the quality-metric TSV the script wrote. What does one row represent? | | | |
| 11 | At the bottom of **Explore and Annotate**, find the scatter plot. How many scans does it plot for the channel you are viewing? Does that match task 1? Which point is the scan you are viewing? | | | |
| 12 | Show **cardiac**, then set **Y = Beat Corr** and **X = SNR**. Hover over the point that looks most unusual and write down its subject and session: \_\_\_\_\_\_\_\_\_\_ | | | |
| 13 | Set **X** to a participant variable (e.g. **age** or **sex**), and change what the points are colored by. What do the colors mean? Then set X back to **SNR**. | | | |
| 14 | **Double-click** the point from task 12. Where did it take you, and is it the scan you picked? | | | |
| 15 | On the **Stats** tab for that scan, look at the waveforms. Does the signal look clean? Where does the scan sit in the histograms compared with the group (solid dark line = this scan, dashed grey line = group mean)? Hide one group of metrics, then show it again. | | | |
| 16 | Open the PDF report for this dataset and find the page for the scan from task 12. Where is the file saved? | | | |

## Part D: After all tasks (8 min)

### D1. Ease of use (System Usability Scale)

Rate each statement: 1 = strongly disagree, 5 = strongly agree.

| # | Statement | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 1 | I think that I would like to use this tool frequently. | | | | | |
| 2 | I found the tool unnecessarily complex. | | | | | |
| 3 | I thought the tool was easy to use. | | | | | |
| 4 | I think that I would need the support of a technical person to be able to use this tool. | | | | | |
| 5 | I found the various functions in this tool were well integrated. | | | | | |
| 6 | I thought there was too much inconsistency in this tool. | | | | | |
| 7 | I would imagine that most people would learn to use this tool very quickly. | | | | | |
| 8 | I found the tool very cumbersome to use. | | | | | |
| 9 | I felt very confident using the tool. | | | | | |
| 10 | I needed to learn a lot of things before I could get going with this tool. | | | | | |

### D2. Usefulness (Perceived Usefulness)

Think about checking the quality of physiological data in your own research.
Rate each statement: 1 = strongly disagree, 4 = neither, 7 = strongly agree.

| # | Using this tool in my work would... | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| 1 | ...let me check data quality more quickly. | | | | | | | |
| 2 | ...improve my quality assessment. | | | | | | | |
| 3 | ...increase my productivity. | | | | | | | |
| 4 | ...make my quality assessment more effective. | | | | | | | |
| 5 | ...make it easier to check data quality. | | | | | | | |
| 6 | Overall, I would find this tool useful in my work. | | | | | | | |

### D3. Usefulness of each feature

1 = not useful, 3 = moderately useful, 5 = very useful. Tick N/A if you did not use it.

| Feature | 1 | 2 | 3 | 4 | 5 | N/A |
|---|---|---|---|---|---|---|
| Loading a BIDS-compliant dataset with no configuration | | | | | | |
| Dataset-wide quality metrics (script + TSV) | | | | | | |
| Signal viewer (zoom, overview window and its length, stacked channels) | | | | | | |
| Head-motion confounds next to the signals | | | | | | |
| Timing badge (trigger verification) | | | | | | |
| Signal quality rating and notes for the whole recording | | | | | | |
| Time-window annotation (artifact annotation) | | | | | | |
| Annotated count, progress bar and opening on the next unannotated scan | | | | | | |
| Scatter plot (viewed scan highlighted, color legend) | | | | | | |
| Stats tab (waveforms, metric tables, group histograms, Metrics shown) | | | | | | |
| PDF report (saved with the metrics) | | | | | | |

### D4. Confidence

1 = strongly disagree, 7 = strongly agree.

| Statement | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| After using the tool, I am confident in my judgement of signal quality. | | | | | | | |

### Open questions (4 min)

**What was the most useful feature?**

**What was missing or got in your way?**

## Facilitator: scoring and reporting

**Task completion.** Per task, report the share of participants with **S**, and with **S or H**. Report tasks marked **–** separately; they show time pressure, not failure. With small samples, give 95% confidence intervals using the adjusted Wald method.

**Task ease (SEQ).** Per task, report the mean and SD (or median and range if n < 10). The published average is about 5.5; tasks below 5 are candidates for redesign. Summarize by part (A-C).

**Ease of use (SUS, 0-100).** For each participant:

- Odd items (1, 3, 5, 7, 9): score − 1
- Even items (2, 4, 6, 8, 10): 5 − score
- Sum the ten values and multiply by 2.5

Report the mean and SD. The benchmark average is 68; above 80 is generally considered good.

**Usefulness (PU, 1-7).** Average the six items per participant, then report the mean and SD across participants. Report Cronbach's alpha if n allows.

**Feature usefulness (1-5).** Report the median per feature and the number of N/A answers, ranked from most to least useful.

**Controls used (Part B).** For each control, report the share of participants who used it alone, after help, or not at all. Controls rarely found alone point to discoverability problems.

**Session length.** Record the total time per participant and report the median.

**Suggested results sentence:** "N participants completed a median of X of 16 tasks unaided (Y% with help) in a median of Z minutes. The mean SUS score was \_\_ (SD \_\_), against a benchmark of 68, and perceived usefulness was \_\_ of 7 (SD \_\_). [Lowest-rated part] received the lowest ease ratings (mean SEQ \_\_)."

**References**

- Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In *Usability Evaluation in Industry*.
- Davis, F. D. (1989). Perceived usefulness, perceived ease of use, and user acceptance of information technology. *MIS Quarterly*, 13(3), 319-340.
- Sauro, J., & Dumas, J. S. (2009). Comparison of three one-question, post-task usability questionnaires. *CHI '09*.

## Facilitator answer key (do not hand out)

| Task | Expected result |
|---|---|
| 1 | Dataset name in the header under the tabs; 80 scans, shown in the Annotations box as "(0/80 … signals are annotated)" |
| 2 | Script finishes without errors; `quality_metrics.tsv`, `dataset.json` and `waveforms/` written to `data/quality/ds006644/` |
| 3-8 | Open: record the scan each participant picked and their reasoning. Score Done for whether they reached a judgement, not for which scan they chose. |
| 5 | Stack the other channel and/or pick a Confound (Auxiliary Signal Options row); the window length is shown over the overview chart |
| 6 | Timing badge next to the file name; hover for the details |
| 7 | A Signal Quality button chosen and a note written; a time window labelled with Annotate On. Labels cannot be edited: replacing means deleting (×) and drawing it again |
| 8 | Saved automatically (note in the Annotations box) to `data/annotations/ds006644/sub-XX/ses-XX/func/…_annotations.json`, with signal quality and notes first, then the windows with times and sample indices. Count goes to 1/80 and the bar starts filling. After reload it opens on the earliest scan not annotated yet for that channel |
| 9 | Timing **not** verified: 21 trigger intervals differ from the TR (first is 0.704 s vs TR 1.8 s). The other 79 scans are trigger-verified. |
| 10 | One row = one channel of one scan (check against the TSV) |
| 11 | "n of 80 scans plotted" next to the legend; the viewed scan is the larger pinkish-red point ("Now viewing" in the legend) |
| 12 | Channel is chosen with the Channel dropdown at the top of the page. Record which scan each participant picked; tasks 14-16 follow from it. Note whether it matches the outlier from task 3. |
| 13 | The legend names the Color by choice (e.g. "Session: ● 01 ● 02") |
| 14 | The Stats tab opens on that scan |
| 15 | Metrics shown box (left, level with the metrics): untick and tick a metric, or Hide all / Show all |
| 16 | Link in the Stats sidebar under **PDF report** (built and saved the first time Stats opens after the metrics are computed); file at `data/quality/ds006644/quality_report.pdf` |