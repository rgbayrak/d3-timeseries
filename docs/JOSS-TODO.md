# JOSS submission checklist

## Phase 1 — Tests that run anywhere

Fixtures, timing/SQI/annotation tests, the path-safety fix, the viewer unit
tests and CI (passing on GitHub) are done (see the testing section in
`paper/paper.md`).

- [ ] Add `npm run build` to CI once the production build is in use (Phase 2)
- [ ] Tests for the chart library core (`createChart`, zoom, brush, `cullToViewport`, `downsample`) under jsdom (needs `jsdom` as a dev dependency). The axis helpers (tick count, tick format, y-axis title position) are already tested without it


## Phase 2 — Run outside the Vite dev server

Today the server only runs as a Vite dev-mode plugin; reviewers must be able to install and run the tool from the README.

- [ ] Move the request handling out of `server/bids-physio-plugin.ts` into a plain Node module, with the Vite plugin as a thin wrapper over it
- [ ] Standalone Node server that serves the production build (`npm run build`, which includes `quality.html`), the `/api/bids/*` endpoints and the computed `data/quality/` files
- [ ] Single launch command, e.g. `npx physai-qa-interactive --bids-root <path> [--derivatives <path>]`
- [ ] Tests for the endpoints (status codes, JSON shapes, 400 on unsafe input) against the fixtures, including `/api/bids/annotation-progress` and the `waveform_quality` / `waveform_comment` fields in `POST /api/bids/annotations`

## Phase 3 — Packaging and release

- [ ] Installable package (`npm install -g physai-qa-interactive`, or publish to npm) with the launch command as its `bin`
- [ ] Versioned GitHub release matching the version in `package.json` and `CITATION.cff`. A `v1.0.0` tag exists, but both files still say `0.1.0`; cut the reviewed release after Phase 2 with all three in sync
- [ ] Zenodo archive of the prev release (DOI `10.5281/zenodo.19389717`) exists; mint a new version DOI for the version reviewed

## Phase 4 — Documentation (JOSS review checklist)

- [ ] **Statement of need** in the README: what problem it solves and who it's for
- [ ] **Installation instructions** for the packaged tool, with dependencies (Node version) listed
- [ ] **Example usage**: a walkthrough on a public OpenNeuro dataset (fetch with DataLad, launch, review, annotate) with the expected output files
- [ ] **API documentation** for the chart library (e.g. generated with TypeDoc), the annotation file format and the quality metrics outputs (`quality_metrics.tsv` columns, `dataset.json`); metric definitions are in `REVIEW.md`
- [ ] **Community guidelines**: how to contribute (`CONTRIBUTING.md` ✓), report issues and get support (Issues and Discussions enabled ✓). Add issue templates and a "Getting help" section in the README pointing to Discussions
- [ ] Code of conduct (`CODE_OF_CONDUCT.md`, e.g. Contributor Covenant)
- [ ] `CITATION.cff`: set `version` and `date-released` for the reviewed release (authors, ORCIDs and affiliations done)

## Phase 5 — The paper

`paper/paper.md` + `paper/paper.bib`, roughly 250–1000 words.

- [ ] Date (title, tags, authors, ORCIDs and affiliations set)
- [x] **Summary** for a non-specialist audience. Drafted; needs your review
- [x] **Statement of need**: the research problem and target users. Drafted; needs your review
- [x] **Software design**: drafted
- [ ] Software design: add the standalone server and launch command once Phase 2 lands
- [ ] Bring the Software design section up to date with the tool: it says "three key components" but lists four; "Group and Individual tabs" are now the scatter plot at the bottom of Explore and Annotate and the Stats tab; the BIDS reader also finds MRIQC confounds and task events (not only fMRIPrep); the "signal quality table" in the viewer was removed. Mention the newer features where they fit (task events chart, On disk data summary, quality metrics run log)
- [ ] Software testing section: add task events, MRIQC confounds, downloaded-file counts and the run log to the list
- [ ] **Research use**: add labs tested the tool (TODO comment in the paper)
- [ ] Metric citations: resolve the open items in `REVIEW.md` (ApEn attribution, missing PaPaGei and Romano 2023 references in `paper.bib`) before the paper cites the metrics
- [ ] Acknowledgements and funding
- [ ] Build the PDF locally or with the JOSS GitHub Action (`openjournals/openjournals-draft-action`) and check it renders

## Phase 6 — Before submitting

- [ ] Re-check if all CI checks pass on `main` before submitting
- [ ] A fresh clone installs and runs from the README instructions alone, on a machine without `data/`
- [ ] Authorship: everyone listed made substantial contributions
- [ ] Submit at https://joss.theoj.org/papers/new
