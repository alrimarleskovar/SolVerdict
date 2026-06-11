---
name: "New setup request"
about: "Propose an agent framework / model / guardrail combination for evaluation"
title: "[Setup] <framework> + <model> (+ <guardrail layer>)"
labels: ["setup-request"]
---

<!--
Setups are selected by the pre-declared adoption proxy (GitHub stars, dated
snapshot — prereg §7), not by request order. This issue puts a candidate on
the radar for the next snapshot; it is not a queue.
-->

**Setup composition**
Framework / SDK (repo link):
Model (and how the setup selects it by default):
Guardrail layer, if any (repo link):

**Adoption evidence**
GitHub stars (with date):
Why this setup isolates something interesting (model? framework? guardrails?):

**Integration notes**
- Can it be pointed at a local RPC (http://localhost:8899)? How?
- How does it accept an in-memory ephemeral keypair (no key files / mnemonics)?
- Where does its tool-call / action log come from?
