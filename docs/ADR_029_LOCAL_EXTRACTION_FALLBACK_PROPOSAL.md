# ADR 029 (PROPOSAL, NOT YET DECIDED): Consent-Gated Local Extraction Fallback for Caption-less Videos

**Status**: 🔍 Proposal — captures reasoning to date, no decision made yet
**Date opened**: 2026-09-07
**Supersedes discussion in**: original (undated, pre-history-index) decision to stay away from yt-dlp/YouTube-download tooling in the server-side pipeline for legal-footprint reasons — that prior decision is not itself recorded as a numbered ADR in this ledger; it is referenced in project memory (`project_night_waves_spuf_20260724.md`: "YouTube ToS pivot to storyboard sprites") as the reason the pipeline moved away from any raw video/audio acquisition path.

---

## 1. Origin of this discussion (chain of thought, not itself the rationale for a decision)

This proposal originated from a personal use case, which is recorded here for continuity but explicitly does **not** serve as the justification for the product decision below — that distinction was maintained deliberately through the conversation that produced this ADR:

- User attended a live, unlisted-at-first, no-captions YouTube session for a paid course. Needed a transcript for personal note-taking via Vintel. No captions existed at watch-time.
- Explored: YouTube native transcript (unavailable at that time), a third-party paywalled tool, a local desktop app (yt-dlp + faster-whisper + Silero VAD + diarization) which failed on a corrupted partial download mid-run, then a cloud pivot (yt-dlp extraction + OpenRouter Whisper).
- Auto-captions did eventually appear (~1hr turnaround, unconfirmed as typical), but by then a distinct, valuable after-hours segment (~20-30 min of privileged Q&A) had been taken down and was permanently unrecoverable by any extraction method, local or server-side.
- **Conclusion drawn during discussion, and reused here**: the personal-use fair-use argument for one already-legitimately-attended video does not generalize to a product-wide automated-scraping decision. Those are two separate legal questions (personal fair use vs. ToS exposure at product scale) and this ADR only addresses the second.

## 2. Problem statement (product-level, independent of the anecdote above)

Some analyzable videos have every other Vintel-required signal available (metadata, thumbnails, description, etc.) except a transcript, because YouTube has not generated captions and the creator did not supply any. Today the pipeline has no fallback for this case beyond a placeholder/failure state.

## 3. Constraint: why server-side extraction remains rejected

- YouTube's ToS prohibits automated/programmatic downloading of content without authorization. A server-side yt-dlp integration means Vintel's own infrastructure (shared IPs, possibly shared credentials) performs this at the scale of its full user base, which is a materially different risk posture than a single individual doing it once.
- Consequence of violation is platform-level (IP blacklisting, credential/API revocation) and could degrade or break the *legitimate* parts of the pipeline (captions retrieval, metadata, oEmbed, etc.) that share the same egress/identity, not just the extraction feature itself.
- Fair use is a copyright-infringement defense; it does not address ToS/contract exposure. The two must not be conflated when evaluating this feature (this was the central correction made during this discussion — see chain of thought above).

## 4. Proposed design: consent-gated, user-machine-executed extraction

Flow:

1. Vintel's existing per-video ingestion check (already runs today to fetch transcript/captions) detects a caption-less video where all other required data is otherwise available.
2. Instead of failing or placeholding, the UI surfaces a modal: explains that no transcript/captions exist for this video, and that proceeding requires running an extraction step **on the user's own machine**, using the user's own network/YouTube session — not Vintel's servers. Includes a link to full terms.
3. User accepts or declines in the modal (single confirm/cancel — no extra flow beyond that decision).
4. On accept, a local helper (see 4a) performs the extraction locally and uploads only the resulting compressed audio (or transcript, if local Whisper is also run — out of scope for this proposal, decided separately) to Vintel via an existing/new upload endpoint.
5. Vintel resumes its normal pipeline (existing OpenRouter cascade transcribes the uploaded audio; downstream dimensions/KG/chat proceed unchanged).
6. On decline, the video simply cannot be processed for this dimension — existing failure/placeholder UX applies.

**4a. What "local helper" actually requires** — this is the part likely to be underestimated if this proposal moves forward:
- A browser tab cannot itself invoke `yt-dlp`; there is no such capability in a sandboxed web page. This requires either:
  - (a) a small installed local companion (Tauri/Electron-lite, a signed native binary, or a CLI) that the modal invokes via a custom URL scheme / local HTTP handshake, similar in shape to the already-tested "Vibe" desktop app referenced in the chain of thought above, or
  - (b) a documented manual fallback: the modal shows the exact `yt-dlp` command to copy/run, and a plain upload button for the resulting file, with no companion app at all.
  - (a) is real, non-trivial engineering (packaging, code-signing, auto-update, cross-platform support, a local trust handshake with the web app) — not "a couple of functions," contrary to the assumption raised earlier in this discussion that most of it was "already done." What's already built (per project memory) is the desktop transcription app's *own* internal use of yt-dlp, not an integration surface that talks to hex-yt-intel's web app.
  - (b) is low/near-zero engineering lift and ships fast, at the cost of more user friction than a single modal click.

## 5. What this design does and does not solve

- **Solves**: removes YouTube ToS/ban exposure from hex-yt-intel's own infrastructure — the extraction traffic originates from the user's own IP/session, not a shared server identity. This was the actual blocking concern behind the original decision to avoid this feature.
- **Does not solve**: the specific incident that prompted this discussion (a since-removed, never-captioned video segment). No extraction architecture — local or server-side — can retrieve content that the rights holder has already taken offline. That failure mode is about extraction *timing* (need it done during/immediately after a live event, before any possible takedown), not about *where* extraction runs. This proposal does not claim to fix that case, and no version of this feature would.
- **Partially solves the product goal**: if the product vision is fully frictionless "paste any URL, everything happens server-side," this proposal does not deliver that — it still requires the user to run something locally (whether a one-click helper or a manual command). It is a scoped, opt-in fallback for the caption-less case, not a general re-adoption of server-side YouTube scraping.

## 6. Open questions before this can move to ACTIVE

- 4a(a) vs 4a(b): ship the low-friction native-helper path (real build/maintenance cost) or the manual-command path (near-zero cost, more friction) first, or ship (b) now and revisit (a) later based on actual usage of the fallback?
- Where does the uploaded audio land — reuse an existing upload surface, or does this need a new authenticated endpoint + storage/retention policy (ties into ADR 012's transcript retention pipeline)?
- Exact ToS/consent copy and where the "link to read more" points — needs non-legal-advice framing consistent with this doc's own caveats.
- How often does the caption-less-but-everything-else-available case actually occur across real usage? Not measured; needed before weighing the maintenance cost of 4a(a) against actual demand.

## 7. Decision

Not yet made. This document exists to preserve the reasoning chain (personal incident → why it doesn't generalize → ToS vs. fair-use distinction → local-execution risk transfer → consent-gated design → its actual scope limits) so a future session or the user can resume from here without re-deriving it.
