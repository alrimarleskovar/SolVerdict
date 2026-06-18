# Trademark & Naming Policy

The licenses in this repository are deliberately dual:

- **Code** — Apache-2.0 (`LICENSE`). Fork it, run it, modify it.
- **Methodology & results** — CC-BY-4.0 (`LICENSE-DOCS`). Reuse with attribution.

What is **NOT licensed** by either of the above:

1. **The project name** ("SolVerdict", or whatever name `config/branding.ts`
   carries at the time of a release).
2. **The designation "official SolVerdict results", "SolVerdict ranking",
   "SolVerdict leaderboard"** or any phrasing that presents a set of benchmark
   numbers as produced or endorsed by this project.

## What this means for forks

- You **may** reuse the harness, the scenarios, and the scoring code under
  Apache-2.0, and reproduce our published results with attribution under
  CC-BY-4.0.
- You **may** publish your own runs of the harness.
- You **must not** present your own runs as *official SolVerdict results or
  rankings*. Name your fork's results clearly as your own (e.g. "results from
  <your-project>, derived from the SolVerdict harness vX.Y").

Rationale: the integrity of a public safety ranking depends on a single,
accountable methodology + provenance chain (pre-registered rubric, dated
commits, published disputes — see prereg §2, §8, §9). A fork that re-runs
modified scenarios under the same banner would break that chain.

Contact for naming questions: open a GitHub issue at https://github.com/alrimarleskovar/SolVerdict/issues
