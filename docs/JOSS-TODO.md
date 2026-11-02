# JOSS submission checklist

## Phase 1 — Tests that run anywhere

Fixtures, timing/SQI/annotation tests, the path-safety fix, the viewer unit
tests and CI (passing on GitHub) are done (see the testing section in
`paper/paper.md`).

- [ ] Add `npm run build` to CI once the production build is in use (Phase 2)
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
- [ ] Versioned GitHub release matching the version in `package.json` and `CITATION.cff`. A `v1.0.0` tag exists, but both files still say `0.1.0`; cut the reviewed release after Phase 2 with all three in sync
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
- [x] **Summary** for a non-specialist audience. Drafted; needs your review
- [x] **Statement of need**: the research problem and target users. Drafted; needs your review
- [x] **Software design**: add the standalone server and launch command once Phase 2 lands
- [ ] **Research use**: add labs tested the tool (TODO comment in the paper)
- [ ] Acknowledgements and funding
- [ ] Build the PDF locally or with the JOSS GitHub Action (`openjournals/openjournals-draft-action`) and check it renders

## Phase 6 — Before submitting

- [ ] Re-check if all CI checks pass on `main` before submitting
- [ ] A fresh clone installs and runs from the README instructions alone, on a machine without `data/`
- [ ] Authorship: everyone listed made substantial contributions
- [ ] Submit at https://joss.theoj.org/papers/new
