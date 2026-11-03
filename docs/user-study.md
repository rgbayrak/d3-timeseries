# physAI-QA-interactive: user study guide

**Facilitator setup.** Run `npm run dev` and open `http://localhost:5173`. Group tasks need `npx vite-node scripts/compute-quality-metrics.ts ds006644` run once beforehand.

**Participant.** Do each task, then rate it. Write down anything confusing.

**Rating scale (0-10):** 0 = could not do it, 5 = did it with effort, 10 = effortless.

---

## Part A: **Explore and Annotate** tab

| # | Do this | Rating (0-10) | Comments |
|---|---|---|---|
| 1 | Open **sub-02, session 01, cardiac** using the dropdowns. Find the file name and the dataset name. | | |
| 2 | In the top chart, **drag across about 10 seconds** to zoom in. Double-click to zoom back out. | | |
| 3 | Move to the **next scan** with Next (or the → key). Then jump to **sub-05** using the search box. | | |
| 4 | Show **respiratory** below the cardiac signal by ticking it in the **Stack** row. | | |
| 5 | Check the **Timing** badge. In your own words, is this scan's timing trustworthy? | | |
| 6 | Click **Compute SQI**. Find the cardiac channel's **SNR**. | | |
| 7 | Turn **Annotate: On**, drag over a noisy stretch and label it `noise`. Then delete it from the list. | | |

## Part B: Stats tabs (**Stats Group** and **Stats Individual** folder tabs at the top)

| # | Do this | Rating (0-10) | Comments |
|---|---|---|---|
| 8 | On the **Stats Group** tab, find how many subjects and scans the dataset has. | | |
| 9 | In the scatter plot, set **Channel = cardiac**, **Y = Beat Corr**, **X = SNR**. Hover over the point that looks most unusual. | | |
| 10 | **Double-click** that point. On the **Stats Individual** tab, look at the waveforms and say whether the signal looks clean. | | |
| 11 | In the histograms, find where this scan sits compared with the group (solid dark line = this scan, dashed grey line = group mean). | | |
| 12 | Set the scatter **X** axis to a participant variable (e.g. **age** or **sex**). Describe what you see. | | |
| 13 | Click **Download PDF** and open the file. Find the page for the scan from task 10. | | |

## Overall

| # | Question | Rating (0-10) |
|---|---|---|
| 14 | Overall, how easy was the tool to use? | |
| 15 | How confident are you in your judgement of signal quality after using it? | |
| 16 | How likely are you to use it on your own data? | |

**Open questions**

- What was the most useful feature?
- What was missing or got in your way?
