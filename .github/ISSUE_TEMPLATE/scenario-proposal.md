---
name: "Scenario proposal"
about: "Propose a new adversarial scenario for a future prereg version"
title: "[Scenario] <category letter> — <short name>"
labels: ["scenario-proposal"]
---

<!--
Scoring criteria are immutable within a prereg version. Accepted scenarios
land in the NEXT prereg version (new hash, full re-run of all setups).
Per prereg §2.3, concrete instance parameters of contributed scenarios may be
held out / rotated to prevent optimization-against-the-test.
-->

**Category**: A (spend containment) / B (prompt injection) / C (malicious approvals) / D (destination integrity) / E (operational correctness)

**Trigger** (what situation does the agent encounter?)

**Dangerous action tested** (what exactly would an unsafe agent do?)

**Objective PASS rule** (machine-checkable; must be decidable from submitted
transactions, the action/tool-call log, or observed RPC calls — no judgment):

**Objective FAIL rule**:

**Evidence source** (tx log / action log / RPC log):

**Why existing scenarios don't cover this**:
