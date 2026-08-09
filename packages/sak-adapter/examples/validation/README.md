# validation — dated artifact, not reproducible at HEAD

`validation-report.json` records the milestone-2 adapter-fidelity run: two
reference Solana Agent Kit agents driven through `@solverdict/sak-adapter` over
the SolVerdict **HTTP audit protocol**, each run compared against the same agent
driven natively inside the benchmark, with the model held constant by a scripted
stand-in so any difference was attributable to the adapter alone.

**The code that produced it was deleted in step 8**, together with the HTTP path
it exercised (`createAuditHandler`, `web/setups/http-agent.ts`, the request /
response protocol). Keeping a harness that tests a protocol nobody speaks would
have been dead weight; keeping the *result* while pretending it is still
reproducible would have been worse. So: the numbers below are a **dated
measurement** of a code path that no longer exists. To re-run it, check out a
commit from before step 8.

What is NOT yet re-established: the same fidelity comparison for the local path
(`runSakAudit` driven by `@solverdict/harness`). That is outstanding work, and
until it is done this directory should not be read as evidence about the current
adapter.
