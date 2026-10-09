# ADR-0003: Capture-status training eligibility (`hasLowConfidence`) and the eligibility-policy cache boundary

- Status: Accepted. The decision is the user's explicit policy choice recorded in `docs/specs/63-capture-eligibility.md` ("Use parser-accepted or manually corrected fields; exclude veterans while any field remains low-confidence. Keep other lineage/data eligibility checks."), scoped by the orchestrator in task T17 (`docs/specs/80-orchestration-plan.md` §T17). Acceptance of this ADR is that user decision; it is **not** a self-review approval of the T17 implementation, which still requires the independent review of 85 §2 before merge.
- Resolves: integration-readiness-review-1 **B1** (accepted/corrected captures excluded by the numeric gate; resolving a review never made a row eligible) and folds in **S2** (the agent's fixed 0.9 non-guest `isGuest` score is raw provenance, not a training authorization boundary).
- Amends: 01 §9 (`RosterVeteran`, optional `hasLowConfidence`), 50 §4 (training rows). No D1 migration. `training-v2` semantics (ADR-0002) unchanged.

## 1. Context
50 §4 trained only on rows with `min_confidence ≥ 0.9`. The API sets `minConfidence` to the minimum raw score over **every** capture field, including `ok` ones, and keeps it after a review correction. Real vocab/dHash acceptance scores are legitimately below 0.9 (vocab accepts from 0.85; card art up to Hamming 10 ⇒ 0.84), and Windows OCR reports a constant 1.0 (Q-100). In the IR1 probe, a real-fixture C# capture with 190 fields, all `ok`, had raw minimum 0.875 and was excluded; a resolved 0.3 field stayed excluded forever.

## 2. Decision
1. **Signal.** `RosterVeteran.hasLowConfidence?: boolean` (strict boolean, optional for backwards compatibility). The API **always** emits it, derived on read as `EXISTS (SELECT 1 FROM capture_fields WHERE veteran_id = v.id AND status = 'low_confidence')` inside the same SELECT as the veteran row (list and detail; PATCH and resolve return detail). It is never stored, so it cannot go stale after ingest, re-ingest, resolve, owner-block remapping or delete, and no migration or extra statement is needed (ingest stays 15, roster 6).
2. **Meaning.** True iff ANY current field is `low_confidence`. Review-item status is ignored: a dismissed item whose field was never corrected keeps the flag true (dismissal is not correction). `ok` and `corrected` fields never set it, whatever their score.
3. **Raw provenance preserved.** `minConfidence` keeps its 01 §9 meaning (raw minimum field score) and is never inflated, recomputed over accepted fields or rewritten on correction. Field confidences are unchanged by resolve.
4. **Engine confidence gate** (`confidenceExclusion` in `packages/engine/src/model/fit.ts`):
   - flag `true` ⇒ excluded (`low-confidence`), even with `minConfidence ≥ 0.9`;
   - flag `false` ⇒ passes the confidence-only gate, even with `minConfidence < 0.9`;
   - flag absent (legacy row, older producer, or a schema that stripped it) ⇒ the unchanged legacy gate `minConfidence ≥ 0.9`;
   - flag present but not a boolean ⇒ excluded as malformed (the runtime schema also rejects it; never coerced).
   Every other exclusion (unknown scenario/outfit/card, deck size, missing parents, unread parent spark blocks, illegal lineage incl. guest rules, bad date, non-finite stats) runs unchanged after the confidence gate. Calibration (50 §8) uses the same `prepareRow`, so its population follows.
5. **Eligibility-policy identity.** `TRAINING_ELIGIBILITY_POLICY = 'capture-status-v1'` (engine export). It is not part of `training-v2`: no snapshot is relabelled and numeric/statistical semantics are unchanged. The web binds every reusable fit to it:
   - base-context `FitRecord` v3 carries `eligibilityPolicy`; a v2 record (pre-T17) is read with `eligibilityPolicy: null` and forces one refit with reason `eligibility-changed`, even when roster ETag/content, master and rules context are identical;
   - browser-local overridden model envelope v2 carries it; a v1 envelope parses but never matches (refit, not corrupt);
   - worker `ContextInfo`/`FitOutput` report it, `SnapshotProvenance` must carry it and the worker's `rank` refuses a missing or different policy;
   - fits whose reported policy differs from the configured context are never POSTed or stored locally.
   The policy is deliberately **not** folded into the T15c rules-context fingerprint: that would invalidate stored browser-local overrides (their `baseFingerprint`) although no rule changed.
6. **Roster identity.** The web roster content digest (`rosterIdentity`) hashes every row, so it includes the flag. The API ETag moves whenever the flag can change, because every flag-changing write (ingest, resolve incl. remap) updates the veteran row and bumps the roster revision.

## 3. Compatibility and consequences
- Old rows and old producers: no flag ⇒ legacy 0.9 gate (conservative; no relaxation). The fixture/golden roster has no flag and its acceptance results are unchanged.
- A consumer whose schema strips unknown keys (an older `RosterVeteran`) silently degrades to the legacy gate; the C# agent does not consume `RosterVeteran`.
- Every browser refits once after upgrade (server snapshot reuse and local overridden models), and populations may grow. Old snapshots stay stored and readable; they are simply not reused.
- T15c invariant kept: overridden models are never read from or written to the snapshot API.
- What this is **not**: evidence that OCR/parsing is correct, verified game mechanics, or real-roster acceptance. Field status is only as good as the agent's acceptance rules (30 §4, Q-100); H4 still has to show real imports, and H2 the cloud path.

## 4. Alternatives considered
- Recompute `minConfidence` over accepted fields / on resolve: rejected — rewrites raw provenance and conflates two meanings.
- Stored `has_low_confidence` column: rejected — duplicates state, needs a migration and statement budget, and can go stale across remap/re-ingest paths.
- Lower the numeric threshold: rejected — still score-driven and arbitrary (S2).
- Fold the policy into the rules fingerprint: rejected (see §2.5).
