# Signal quality metrics: review

What each metric computes, where it comes from, and open points to check.
Source of truth: `computeChannelMetrics()` in `src/data/sqi-metrics.ts`. The
dataset-wide script (`scripts/compute-quality-metrics.ts`) calls it.

## Conventions

- *x* = the raw channel samples (*n* samples at *f* Hz). No filtering,
  detrending or baseline removal is applied before any metric.
- μ = mean of *x*; σ = sample standard deviation (d3 `deviation`, divides by *n* − 1).
- **Pulsatile** channels: the name matches `cardiac|ppg|pulse|ecg|pleth`.
  **Respiratory** channels: the name matches `respiratory|resp|rsp|chest|belt|breath`.
  Matching is by name only, inside `sqi-metrics.ts`.
- **Peaks**: local maxima at least 0.3 s apart for pulsatile channels (≤ 200 beats/min)
  and 1.5 s apart for respiratory channels (≤ 40 breaths/min). When two peaks are closer
  than that, the higher one is kept. There is no amplitude or prominence threshold.
- Windowed metrics use non-overlapping windows; a partial last window is dropped.
  Windows that cannot be computed (e.g. flat) are skipped, and the result is the mean of the remaining windows.
- `NaN` (shown as N/A, or `n/a` in the TSV) means the metric does not apply to
  that channel or could not be computed.
- The dataset-wide script computes metrics only for channels found in the physio
  channel dictionary (`src/quality/channels.ts`). Trigger, marker and unknown
  columns are excluded and listed in `dataset.json`.

| Group | Metric (TSV column) | Applies to |
|---|---|---|
| Basic | Mean (`mean`), Std Dev (`std_dev`) | all channels |
| Distribution | SNR (`snr`), Kurtosis (`kurtosis`), Skewness (`skewness`), ZCR (`zero_crossing_rate`) | all channels |
| PaPaGei | sVRI (`svri`), IPA (`ipa`), SQI (`sqi`) | pulsatile only |
| PhysioQC | Kurt (win) (`kurtosis_windowed`), ApEn (`approx_entropy`) | pulsatile only |
| PhysioQC | Beat Corr (`beat_correlation`) | pulsatile and respiratory |

How to add or remove a metric is described in [CONTRIBUTING.md](CONTRIBUTING.md#quality-metrics-adding-or-removing-a-metric).
Min, Max, Median and % Non-Zero were removed: as plain range statistics they said little about signal quality.

---

## Basic

### Mean
- **Computes:** arithmetic mean of all samples, μ = (1/*n*) Σ *x*ᵢ.
- **Citation:** standard descriptive statistic; no specific source.

### Std Dev
- **Computes:** sample standard deviation, σ = √[ Σ (*x*ᵢ − μ)² / (*n* − 1) ].
- **Citation:** standard descriptive statistic; no specific source.

## Distribution

### SNR
- **Computes:** μ / σ over the whole recording (Infinity when σ = 0).
- **Citation:** none. This is the inverse coefficient of variation, not a spectral signal-to-noise ratio.
- **Review:** it depends entirely on the recording's DC offset. For signals centred near zero
  (common after preprocessing) it is close to 0 or negative and does not reflect noise. It is not the
  same as Elgendi's (2016) SNR index. Consider renaming it, or replacing it with a
  power-ratio definition.

### Kurtosis
- **Computes:** excess kurtosis over the whole recording,
  (1/*n*) Σ (*x*ᵢ − μ)⁴ / σ⁴ − 3. Zero for a normal distribution; positive means heavy tails or spikes.
- **Citation:** Elgendi 2016 (kurtosis index K_SQI) [1].
- **Review:** this mixes a population fourth moment (÷ *n*) with the sample σ (÷ *n* − 1). The bias is
  negligible for long recordings. Elgendi computes it per segment; see **Kurt (win)**.

### Skewness
- **Computes:** whole-recording skewness, (1/*n*) Σ (*x*ᵢ − μ)³ / σ³.
- **Citation:** Elgendi 2016 (skewness index S_SQI, the best-performing index in that study) [1].
- **Review:** same mixed normalisation as Kurtosis. The windowed version is **SQI** below.

### ZCR (Hz)
- **Computes:** number of sign changes (between ≥ 0 and < 0) divided by the duration *n*/*f*,
  i.e. zero crossings per second.
- **Citation:** Elgendi 2016 (zero-crossing rate index Z_SQI) [1].
- **Review:** (1) The signal is **not mean-centred** first, so any DC offset gives a ZCR near 0
  regardless of quality. Centring on μ would make it meaningful for raw recordings.
  (2) A sinusoid at *f* Hz gives 2*f* crossings per second, so the "Hz" label overstates the frequency by 2×.

## PaPaGei morphology (pulsatile channels only)

These three metrics are the PPG morphology targets used by PaPaGei [2]. Beats
are delimited trough to trough: the minimum before the first peak, the minimum
between consecutive peaks, and the minimum after the last peak. At least 2 peaks are required.

### sVRI: stress-induced vascular response index
- **Computes:** for each beat with its systolic peak at offset *s* from the trough and length *L*:
  sVRI = mean(post-peak samples) / mean(pre-peak samples)
  = [*s* · Σ_post *x*] / [(*L* − *s*) · Σ_pre *x*]. Reported as the mean over beats.
- **Citation:** used as a PPG morphology label in PaPaGei [2]. Originally proposed by Lyu et al. 2015 [3].
- **Review:** this is a ratio of raw amplitudes, so it is only meaningful when the signal is strictly
  positive (no baseline removal is applied). It is also computed for **ECG**, because the name
  rule treats `ecg` as pulsatile, but sVRI is defined for PPG only.

### IPA: inflection point area ratio
- **Computes:** per beat, systolic area / diastolic area, split at the dicrotic notch:
  IPA = Σ_{trough..notch} *x* / Σ_{notch+1..next trough} *x*. Reported as the mean over beats.
  The notch is approximated as the first local minimum within the first 60% of the descent from
  the peak to the next trough, or as the minimum of that range if none is found.
- **Citation:** used in PaPaGei [2]. Originally proposed by Wang et al. 2009 [4].
- **Review:** as for sVRI, it uses raw-amplitude areas (sensitive to baseline) and is not meaningful for ECG,
  which has no dicrotic notch. The notch detector is a heuristic with no tests against labelled notches.

### SQI: windowed skewness
- **Computes:** skewness m₃ / m₂^(3/2) in non-overlapping 5 s windows (population
  moments), averaged over windows.
- **Citation:** Elgendi 2016 skewness index S_SQI [1], as used by PaPaGei [2].
- **Review:** the generic label "SQI" hides that this is skewness. "Skew (5 s)" would be clearer.

## PhysioQC

### Kurt (win): windowed kurtosis
- **Computes:** excess kurtosis m₄ / m₂² − 3 in non-overlapping 60 s windows, averaged
  over windows. Pulsatile channels only; needs at least 60 s of data.
- **Citation:** Elgendi 2016 kurtosis index K_SQI [1].
- **Review:** the 60 s window length is a project choice. Check it against the segment length
  used in [1].

### ApEn: approximate entropy
- **Computes:** ApEn(*m* = 2, *r* = 0.2 · σ_window) in non-overlapping 1 s windows, averaged over
  windows. ApEn = Φᵐ − Φᵐ⁺¹, where Φᵐ = mean over templates of ln(fraction of length-*m*
  templates within Chebyshev distance *r*), self-matches included. Lower values mean a more regular signal.
  Pulsatile channels only.
- **Citation:** Pincus 1991 (method) [5]. The code and UI attribute it to "Elgendi 2016".
- **Review:** Elgendi's entropy index (E_SQI) is a different, Shannon-type entropy, not approximate
  entropy. Either cite Pincus [5] alone, or implement E_SQI if the aim is to follow [1].
  A 1 s window holds less than about one cardiac cycle at rest, so each window sees very little structure.
  Compute cost is O(*f*²) per window, which makes this the slowest metric at high sampling rates.

### Beat Corr: beat/breath template correlation
- **Computes:** split the signal at consecutive peaks (beats for pulsatile channels, breaths for respiratory ones),
  resample each segment to 100 points, average them into a template, and report the mean
  Pearson correlation of each segment with the template. Needs at least 3 peaks. Values near 1 mean
  consistent beat shape.
- **Citation:** the code and UI cite "Romano 2023" (PhysioQC), but **no full reference exists in the
  repository** (not in `paper/paper.bib`). Template-matching quality indices for pulsatile
  signals are described in Li & Clifford 2012 [6] and Orphanidou 2017 [7].
- **Review:** add the full Romano 2023 reference or replace the citation. Segments run peak to peak,
  not trough to trough as in the PaPaGei metrics. Peak detection has no prominence threshold,
  so noise peaks in raw respiratory signals can split breaths.

---

## Summary of open items

1. **Citations to complete:** Romano 2023 (Beat Corr) and PaPaGei [2] are not in `paper/paper.bib`.
   Verify [3] and [4] before adding them.
2. **ApEn attribution:** cite Pincus 1991 rather than Elgendi 2016, or implement Elgendi's E_SQI.
3. **PPG-only metrics on ECG:** sVRI, IPA (and the dicrotic notch) run on any channel named `ecg`.
   Restrict them to PPG/pulse channels.
4. **SNR** is μ/σ (offset-dependent). Rename it or redefine it.
5. **ZCR** is computed on the uncentred signal, and its "Hz" label is 2× the oscillation frequency.
6. **Raw-amplitude ratios** (sVRI, IPA) assume a positive baseline. No detrending or baseline removal is applied.
7. **Channel typing** in `sqi-metrics.ts` uses its own name regex. It could use the signal type from the
   physio channel dictionary (`src/quality/channels.ts`) instead, so electrodermal and other channels are handled explicitly.

## References

1. Elgendi M. Optimal signal quality index for photoplethysmogram signals. *Bioengineering* 2016;3(4):21. doi:10.3390/bioengineering3040021
2. Pillai A, Spathis D, Kawsar F, Malekzadeh M. PaPaGei: Open foundation models for optical physiological signals. arXiv:2410.20542 (2024); ICLR 2025. *(verify, not yet in paper.bib)*
3. Lyu Y, et al. Measuring photoplethysmogram-based stress-induced vascular response index to assess cognitive load and stress. *Proc. CHI* 2015. *(verify)*
4. Wang L, Pickwell-MacPherson E, Liang YP, Zhang YT. Noninvasive cardiac output estimation using a novel photoplethysmogram index. *Proc. IEEE EMBC* 2009. *(verify)*
5. Pincus SM. Approximate entropy as a measure of system complexity. *PNAS* 1991;88(6):2297–2301. doi:10.1073/pnas.88.6.2297
6. Li Q, Clifford GD. Dynamic time warping and machine learning for signal quality assessment of pulsatile signals. *Physiol. Meas.* 2012;33(9):1491–1501.
7. Orphanidou C. Quality assessment for the photoplethysmogram (PPG). In: *Signal Quality Assessment in Physiological Monitoring*. Springer; 2017. p. 41–63.
