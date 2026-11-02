# JOSS submission checklist

What's needed to submit to the [Journal of Open Source Software](https://joss.theoj.org/).
Research features and improvements live in the TODO list in
[CONTRIBUTING.md](../CONTRIBUTING.md#todo--improvements); this file only tracks
publication readiness.

**Workflow:** when an item is done, write it up in the matching section of
[paper/paper.md](../paper/paper.md) and delete it from this list. Only open
work stays here.

## Scope: why this matters

JOSS treats most web-based research tools as out of scope unless they either
**(1) expose a core library through a web interface** (like R/Shiny apps) or
**(2) show rigorous domain modelling and testing**. The plan is to meet (1): a
Python physio core library, with the viewer as a thin web layer over it.

---

## Phase 1 — Tests that run anywhere

Fixtures, timing/SQI/annotation tests and the path-safety fix are done (see
*Quality control* in `paper/paper.md`).

- [ ] CI workflow (`.github/workflows/ci.yml`) passing on GitHub. Passes locally (typecheck + 115 tests); not yet pushed

## Phase 2 — Python physio core library

The research logic, separated from any UI.

- [ ] Choose the package name and layout (e.g. `src/<pkg>/` with `pyproject.toml`)
- [ ] Port BIDS discovery: subjects, sessions, tasks, runs, sidecar fallbacks, broken symlink handling
- [ ] Port physio reading, including quality sidecars
- [ ] Port timing: trigger detection, trigger verification, BOLD timing lookup, confound volume times
- [ ] Port confounds reading
- [ ] Port SQI metrics
- [ ] Port annotation storage with path validation
- [ ] pytest suite on the same `test/fixtures/`, matching the TypeScript results value-for-value
- [ ] Typed public API (type hints) with docstrings
- [ ] Add pytest to CI

## Phase 3 — Web layer on top of the core

- [ ] FastAPI app exposing the core through the existing `/api/bids/*` endpoints (same JSON shapes)
- [ ] Viewer talks to FastAPI instead of the Vite dev plugin
- [ ] Remove the duplicated TypeScript server logic (`server/bids-layout.ts`) once the Python core matches it
- [ ] Single launch command, e.g. `<pkg> view --bids-root <path>` (serves the built viewer + API)
- [ ] Works as an installed package, not only in a dev checkout

## Phase 4 — Viewer maintainability

- [ ] Split `src/demos/bids-physio-viewer.ts` (~1,550 lines) into state, controls, charts (focus / context / stack / confounds), annotations and SQI table modules
- [ ] Centralise viewer state in one object; render functions redraw from state
- [ ] Tests for the chart library core (`createChart`, zoom, brush, `cullToViewport`, `downsample`) under jsdom

## Phase 5 — Packaging and release

- [ ] Python package installable with `pip install` (publish to PyPI)
- [ ] Versioned GitHub release (e.g. `v1.0.0`) matching the version in `pyproject.toml`, `package.json` and `CITATION.cff`
- [ ] Zenodo archive of the release (DOI `10.5281/zenodo.19389717` exists; confirm it points at the reviewed version, or mint a new version DOI)

## Phase 6 — Documentation (JOSS review checklist)

- [ ] **Statement of need** in the README: what problem it solves and who it's for
- [ ] **Installation instructions** for the Python package and the viewer, with dependencies listed
- [ ] **Example usage**: a real-world example using the core library without the viewer (script or notebook) and one with the viewer
- [ ] **API documentation** for the core library (generated from docstrings, e.g. mkdocstrings or Sphinx)
- [ ] **Community guidelines**: how to contribute (`CONTRIBUTING.md` ✓), report issues and get support. Add issue templates and a support note
- [ ] Code of conduct (`CODE_OF_CONDUCT.md`, e.g. Contributor Covenant)
- [ ] `CITATION.cff`: set `version` and `date-released` for the reviewed release (authors, ORCIDs and affiliations done)

## Phase 7 — The paper

`paper/paper.md` + `paper/paper.bib` (skeleton created), roughly 250–1000 words.

- [ ] Date (title, tags, authors, ORCIDs and affiliations set)
- [ ] **Summary** for a non-specialist audience. Drafted; needs your review
- [ ] **Statement of need**: the research problem and target users. Drafted; needs your review
- [ ] **State of the field**: drafted for phys2bids, NeuroKit2 and PhysIO from memory; verify those claims, then add peakdet, physioqc (physiopy), niphlem and bidsphysio
- [ ] **Software design**: drafted for the current TypeScript server + viewer; rewrite once the Python core (Phases 2–3) lands
- [ ] Research use: ds006644 and ds000210 drafted; confirm the CNeuroMod `movie10`/`shinobi` use and add any studies using the tool
- [ ] Verify every entry in `paper.bib` (written from memory) and add the missing ones listed at its top
- [ ] Acknowledgements and funding
- [ ] References in `paper.bib` with DOIs, including the SQI method sources cited in the code (Elgendi 2016, Romano 2023, Pincus 1991, PaPaGei)
- [ ] Build the PDF locally or with the JOSS GitHub Action (`openjournals/openjournals-draft-action`) and check it renders

## Phase 8 — Before submitting

- [ ] Repository is public, with issues enabled
- [ ] All CI checks pass on `main`
- [ ] A fresh clone installs and runs from the README instructions alone, on a machine without `data/`
- [ ] Authorship: everyone listed made substantial contributions; commit history reflects it
- [ ] Submit at https://joss.theoj.org/papers/new
