---
title: 'physAI-QA-interactive: an interactive visualization and annotation tool for physiological recordings in BIDS fMRI datasets'
tags:
  - TypeScript
  - Python
  - neuroimaging
  - physiological recordings
  - BIDS
  - fMRI
  - signal quality
authors:
  - name: Roza Gunes Bayrak
    orcid: 0000-0002-7197-1248
    affiliation: 1
  - name: Catie Chang
    orcid: 0000-0003-1541-9579
    affiliation: "1, 2, 3"
affiliations:
  - name: Electrical and Computer Engineering, Vanderbilt University, Nashville, TN 37235, United States
    index: 1
  - name: Biomedical Engineering, Vanderbilt University, Nashville, TN 37235, United States
    index: 2
  - name: Vanderbilt University Institute of Imaging Science, Nashville, TN 37235, United States
    index: 3
date: TODO
bibliography: paper.bib
---

<!--
Drafting notes (remove before submission)
- Completed items from docs/JOSS-TODO.md are written up here, in the
  section they belong to, and removed from the checklist.
- "Software design" describes the code as it is today (TypeScript server +
  viewer). Add the standalone server and launch command once JOSS-TODO
  Phase 2 lands.
- Claims about other tools in "State of the field" are from memory: check
  each one against the tool's current documentation.
- Check the current JOSS paper guidelines for required sections before
  submitting: https://joss.readthedocs.io/en/latest/paper.html
-->

# Summary

physAI-QA-interactive provides a single interface for visualizing, labeling and
annotating artifacts, both across whole recordings and within time windows. It
is designed for researchers who curate, quality-check or reuse BIDS datasets
with concurrent physiological recordings. It replaces dataset-specific in-house
scripts and viewers with one interactive workflow that behaves the same way on
any BIDS dataset: review every channel of every scan, compute modality-specific
quality metrics, compare physiological events across modalities, and annotate
artifacts directly on the signal under review. Keeping visualization and
annotation together streamlines review, and recording every decision in one
shared format makes quality assessment consistent and reproducible across raters. 
The outputs, per-channel quality metrics and artifact annotations, are stored as
human-readable JSON files for use in downstream processing, whether to define
inclusion criteria for an analysis or to guide artifact correction.

# Statement of need

Systemic physiological processes, once primarily regarded as confounding noise
in fMRI studies, are increasingly recognized as valuable signals linked to
cognitive processes and individual differences in brain function [@yuan2013].
Concurrent recordings of peripheral physiology, such as cardiac and respiratory
signals, can enhance fMRI analysis through improved noise modeling
[@glover2000; @kasper2017] and provide complementary insights into brain-body
interactions. However, the utility of physiological data is contingent upon
recording quality and expertise in data handling.

# State of the field

Quality assessment of physiological signals poses challenges distinct from
those addressed by established neuroimaging QA pipelines [@gray2009;
@bulte2017]. For fMRI, automated tools such as MRIQC [@esteban2017] have
standardized quality evaluation through image quality metrics and visual
reports, and their use has been formalized into reproducible QC protocols
[@provins2023]. No comparable solution exists for concurrent physiological
recordings. BIDS standardizes how these recordings are stored
[@gorgolewski2016], and community efforts such as physiopy have begun
compiling recommended practices for their acquisition and processing
[@phys2bids; @physiopy2026], but the field still lacks a standardized approach
to physiological quality assessment. Valuable public tools exist, such as PhysIO [@kasper2017]
and AFNI's `physio_calc.py` [@lauren2024], but they are designed primarily for
physiological noise modeling. These tools process individual recordings through scripts; none
offers an interactive, dataset-wide interface for reviewing, labeling and
annotating physiological signals. Signal quality indices for cardiac signals are well
established in biomedical engineering [@orphanidou2015; @li2012; @elgendi2016]
and available in general-purpose toolboxes such as NeuroKit2
[@makowski2021]. Beyond these, most labs that use physiological measures 
rely on their own in-house scripts and viewers, 
so QA practices vary widely between groups. This inconsistency is
a significant obstacle for large-scale studies and data-sharing initiatives, 
where standardized quality control is essential.

# Software design

physAI-QA-interactive is a browser-based tool for exploring and annotating
physiological recordings stored in the Brain Imaging Data Structure (BIDS)
[@gorgolewski2016]. It discovers every subject, session, task and run in a
dataset and visualizes multimodal physiological signals alongside auxilliary measures. 
Researchers can step through all scans of a dataset, zoom
into signals, compute per-channel signal quality indices on recordings,
and mark artifacts as time-stamped annotations saved alongside the dataset for
later correction or use for training machine learning models.
physAI-QA-interactive is the first released tool of physAI-QA, the quality
assurance (QA) component of the physAI research suite for physiological data.

*Note: Throughout this paper, QA stands for quality assurance: not only assessing
signal quality, but also acting on it by labeling, annotating and correcting
artifacts.

physAI-QA-interactive builds on open-source community standards and tools: it reads data
organized in BIDS [@gorgolewski2016] and works directly with datasets managed by
DataLad [@halchenko2021]. Its documentation shows how to install a dataset from
OpenNeuro [@markiewicz2021] with DataLad and fetch only the physiological and
confound files, so users can start reviewing public data without downloading
whole datasets. It has three key components:

- **BIDS reader.** Discovers subjects, sessions, tasks and runs, follows BIDS
  metadata inheritance, skips files that DataLad has not yet fetched, and
  locates fMRIPrep confounds and BOLD sidecars. Results are served to the
  browser as a JSON API.
- **Signal quality metrics.** Whole-recording statistics for every channel,
  plus windowed and beat-level metrics for cardiac [@elgendi2016; @pincus1991]
  and respiratory channels.
- **Viewer and annotation.** Linked overview and detail charts, built on a
  TypeScript chart library over D3 [@bostock2011], stay responsive on
  high-rate recordings. Extra channels and motion confounds follow the same
  time window. Annotations are saved per scan and channel as JSON with times
  and sample indices, ready to use as artifact masks. The interface keeps all
  of its state in a single object; charts, controls, annotations and the
  signal quality table are separate modules that receive state and page
  elements as arguments rather than reaching into the page themselves.

These follow four design goals: a low entry barrier (any standard BIDS dataset,
no configuration), standardized checks with flexible judgement (fixed metric
definitions and annotation format; each team decides exclusions and labels),
transparency (documented metrics, outputs stored as plain files), and
modularity (data access and metrics separate from the interface).


# Software testing

Automated tests cover:

- **BIDS reading:** dataset discovery, sidecar lookup, and physiological and
  confound reading, on two small synthetic BIDS datasets included in the
  repository and on real OpenNeuro [@markiewicz2021] datasets when present.
- **Timing checks:** trigger detection and verification.
- **Signal quality metrics:** values on synthetic signals with known statistics.
- **Annotations:** saving, loading, and rejection of unsafe file paths.
- **Interface logic:** annotation format, scan navigation and search, session
  resume, chart helpers and the signal quality table.

# Research use

The software has been developed and tested on public datasets. On
DMT-HAR-MED (ds006644) [@egger2025dataset; @egger2025], a multi-echo dataset (ds000210) [@dupre2017] 
and with the CNeuroMod `movie10` and `shinobi` datasets.

<!-- TODO: describe any study or lab that uses the tool for its own analyses. -->

# Outlook

physAI-QA-interactive is the manual half of physAI-QA. Its companion,
physAI-QA-auto, is in development and will bring automated artifact detection,
annotation and correction. Because every annotation made in
physAI-QA-interactive records both times and sample indices in a shared format,
the labels researchers create today can train and evaluate those automated
tools, closing the loop between expert review and automated QA.

# AI usage disclosure

Code in physAI-QA-interactive was generated with Anthropic's Claude (Claude
Opus 5.5, via Claude Code). The lead author reviewed and manually approved all
changes.

# Acknowledgements

TODO

# References
