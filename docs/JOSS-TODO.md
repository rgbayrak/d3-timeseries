# JOSS submission checklist

What's needed to submit physAI-QA-interactive to the
[Journal of Open Source Software](https://joss.theoj.org/). Research features
and improvements live in the TODO list in
[CONTRIBUTING.md](../CONTRIBUTING.md#todo--improvements); this file only tracks
publication readiness.

**Workflow:** when an item is done, write it up in the matching section of
[paper/paper.md](../paper/paper.md) and delete it from this list. Only open
work stays here.

## Scope: why this matters

JOSS treats most web-based research tools as out of scope unless they either
**(1) expose a core library through a web interface** (like R/Shiny apps) or
**(2) show rigorous domain modelling and testing**. physAI-QA-interactive is
finished as a tool, so this submission takes route (2): a modular, well-tested
TypeScript codebase that reviewers can install and run from the README. A
separate core library (route 1) belongs to physAI-QA-auto; see *Deferred* at
the end.

---

## Phase 1 — Tests that run anywhere

Fixtures, timing/SQI/annotation tests, the path-safety fix and the viewer unit
tests are done (see *Quality control* in `paper/paper.md`).

- [ ] CI workflow (`.github/workflows/ci.yml`) passing on GitHub. Passes locally (typecheck + 162 tests); not yet pushed
- [ ] Tests for the chart library core (`createChart`, zoom, brush, `cullToViewport`, `downsample`) under jsdom (needs `jsdom` as a dev dependency)

## Phase 2 — Run outside the Vite dev server

Today the server only runs as a Vite dev-mode plugin; reviewers must be able to
install and run the tool from the README.

- [ ] Move the request handling out of `server/bids-physio-plugin.ts` into a plain Node module, with the Vite plugin as a thin wrapper over it
- [ ] Standalone Node server that serves the production build (`npm run build`) and the `/api/bids/*` endpoints
- [ ] Single launch command, e.g. `npx physai-qa-interactive --bids-root <path> [--derivatives <path>]`
- [ ] Tests for the endpoints (status codes, JSON shapes, 400 on unsafe input) against the fixtures

## Phase 3 — Packaging and release

- [ ] Installable package (`npm install -g physai-qa-interactive`, or publish to npm) with the launch command as its `bin`
- [ ] Versioned GitHub release (e.g. `v1.0.0`) matching the version in `package.json` and `CITATION.cff`
- [ ] Zenodo archive of the release (DOI `10.5281/zenodo.19389717` exists; confirm it points at the reviewed version, or mint a new version DOI)

## Phase 4 — Documentation (JOSS review checklist)

- [ ] **Statement of need** in the README: what problem it solves and who it's for
- [ ] **Installation instructions** for the packaged tool, with dependencies (Node version) listed
- [ ] **Example usage**: a walkthrough on a public OpenNeuro dataset (fetch with DataLad, launch, review, annotate) with the expected output files
- [ ] **API documentation** for the chart library (e.g. generated with TypeDoc) and the annotation file format
- [ ] **Community guidelines**: how to contribute (`CONTRIBUTING.md` ✓), report issues and get support. Add issue templates and a support note
- [ ] Code of conduct (`CODE_OF_CONDUCT.md`, e.g. Contributor Covenant)
- [ ] `CITATION.cff`: set `version` and `date-released` for the reviewed release (authors, ORCIDs and affiliations done)

## Phase 5 — The paper

`paper/paper.md` + `paper/paper.bib`, roughly 250–1000 words.

- [ ] Date (title, tags, authors, ORCIDs and affiliations set)
- [ ] **Summary** for a non-specialist audience. Drafted; needs your review
- [ ] **Statement of need**: the research problem and target users. Drafted; needs your review
- [ ] Cite "our findings" in the Statement of need (currently `[TODO: cite]`)
- [ ] **State of the field**: drafted for phys2bids, NeuroKit2 and PhysIO from memory; verify those claims, then add peakdet, physioqc (physiopy), niphlem and bidsphysio
- [ ] **Software design**: drafted for the current code; add the standalone server and launch command once Phase 2 lands
- [ ] Research use: replace the ds006644 timing example with a QA example; confirm the CNeuroMod `movie10`/`shinobi` use and add any studies using the tool
- [ ] Verify every entry in `paper.bib` written from memory and add the missing ones listed at its top
- [ ] Acknowledgements and funding
- [ ] References in `paper.bib` with DOIs, including the SQI method sources cited in the code (Elgendi 2016, Romano 2023, Pincus 1991, PaPaGei)
- [ ] Build the PDF locally or with the JOSS GitHub Action (`openjournals/openjournals-draft-action`) and check it renders

## Phase 6 — Before submitting

- [ ] Repository is public, with issues enabled
- [ ] All CI checks pass on `main`
- [ ] A fresh clone installs and runs from the README instructions alone, on a machine without `data/`
- [ ] Authorship: everyone listed made substantial contributions; commit history reflects it
- [ ] Submit at https://joss.theoj.org/papers/new

---

## Deferred to physAI-QA-auto

Not part of this submission. Kept here so the plan isn't lost; move to the
physAI-QA-auto repository when it exists.

- Python physio core library: BIDS discovery, physio and confounds reading, timing verification, SQI metrics and annotation storage, ported from `server/bids-layout.ts` and `src/data/sqi-metrics.ts`, with a pytest suite on the same `test/fixtures/` matching the TypeScript results value-for-value
- FastAPI service exposing that core (the same `/api/bids/*` JSON shapes), so physAI-QA-interactive can switch its back end without UI changes
- Python packaging (PyPI) and API documentation from docstrings
