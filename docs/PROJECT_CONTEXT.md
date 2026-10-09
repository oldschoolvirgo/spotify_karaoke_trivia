# SYHO Music Trivia — Project Context

**Status:** Pre-production; Milestone 8 (biography fact extraction and prompt budgeting) functionally tested on 2026-10-09. Git commit status should be verified locally.

## Purpose
Build a host-operated music trivia experience for approximately two-hour events, targeting roughly 50–60 questions. Spotify/Spicetify provides music playback and track metadata. AI proposes trivia questions grounded in available source material. A host reviews questions before they enter a reusable bank. The planned live game uses physical team buzzers instead of requiring guests to interact heavily with phones.

## Actual repository layout (reported 2026-10-09)
```text
src/
    index.ts
.gitignore
80s-trivia-enriched.json
package.json
package-lock.json
playlistNormalization.txt
README.md
triviaAdmin.ts
tsconfig.json
worker-configuration.d.ts
wrangler.jsonc
```
This document and `AGENTS.md` are new additions. There is currently no separate `ARCHITECTURE.md`.

## Implemented / tested pipeline
1. **Playlist import and normalization:** Import a Spotify playlist into a structured source. Preserve playlist entries and deduplicate canonical recordings; maintain associated artist records.
2. **Source enrichment:** Collect relevant recording/artist data and available lyrics and artist biographies via the Spicetify/Spotify environment.
3. **Biography fact extraction and caching:** Store extracted biography trivia facts by artist and reuse them for question generation.
4. **AI candidate generation:** `triviaAdmin.ts` assembles a grounded prompt; `src/index.ts` forwards it to Cloudflare Workers AI using `@cf/openai/gpt-oss-20b`.
5. **Deterministic validation:** Validate candidate structure and source grounding; reject candidates that fail rules. Human review remains part of the intended approval workflow.

### Data model and identity
- Source schema V2 organizes `entries`, `recordings`, `artists`, and `stats`.
- Recording identity may use ISRC, canonical Spotify URI, or Spotify URI, depending on availability.
- Playlist entries may repeat a recording; these are not the same as unique recordings.
- Artist biography trivia facts are cached in artist-associated structures, including `biography.triviaFacts` and generation working-source data.
- **Important:** An ISRC does not by itself establish the original release year of a song.

## Cloudflare Worker
- Code: `src/index.ts`; configuration: `wrangler.jsonc`.
- Routes: `GET /health` and `POST /api/ai`; the AI endpoint handles CORS for `https://xpui.app.spotify.com`.
- Model: `@cf/openai/gpt-oss-20b`, chosen server-side to use eligible Workers AI free allocation.
- Prompt hard limit: 20,000 characters; request body is bounded separately.
- The model's reasoning can exhaust completion tokens before producing final content. A low-reasoning system instruction was tested successfully with a 4,000-token completion cap; verify current Worker code before changing this behavior.
- A successful HTTP 200 alone does **not** guarantee usable generated content; inspect `choices[0].message.content`, `finish_reason`, and token usage when debugging.

## Milestone history
- **Milestones 1–6:** Earlier playlist/source normalization, enrichment, and AI generation groundwork. Exact per-milestone acceptance criteria are not reconstructed here; consult Git history and existing source before adding details.
- **Milestone 7 — Candidate validation:** Deterministic validation added and previously checkpointed with the label `milestone-7-candidate-validation`.
- **Milestone 8 — Biography fact extraction and prompt budgeting:** Added biography trivia fact extraction/cache reuse, deterministic fact selection to fit prompt budget, and stronger prompt instructions for verbatim evidence citations. Functionally tested on the recording `GBUM71029622` (Queen and David Bowie, “Under Pressure”).

### Milestone 8 acceptance evidence (2026-10-09)
- Cached biography facts: Queen **18**, David Bowie **20**.
- Final generation prompt: **17,926 characters**, under the **18,000-character client budget** and **20,000-character Worker hard limit**.
- AI generated **3** candidate questions; deterministic validation marked **3 valid, 0 invalid**.
- Earlier run: **5** candidates, **4 valid, 1 rejected** for `UNGROUNDED_ARTIST_BIOGRAPHY`, showing strict evidence matching works.
- These results establish a successful functional sample, **not** comprehensive production readiness or a guarantee that future AI generations will always validate.

## Design decisions and guardrails
- **Grounding:** For biography-based questions, `sourceFact.value` must exactly match a supplied `sourceText` and appear in the authoritative biography. Do not silently normalize or paraphrase source citations to force validation.
- **Budgeting:** Limit selected biography facts in the generation prompt without deleting the full cached fact set.
- **Validation versus quality:** Passing deterministic checks does not imply a question is engaging, non-repetitive, or well balanced. Keep human review.
- **Question variety:** Repetitive lyric questions and overly obvious answer choices are known quality concerns to address in later work, not reasons to weaken Milestone 8 validation.
- **Scope discipline:** Functional milestones first; styling and polish later. Use Git checkpoints and fast end-to-end tests while pre-production.
- **Server-side AI:** Keep model configuration and AI execution in the Worker.

## Planned / not yet established as implemented
- **Approved question bank in Cloudflare D1:** Store reviewed and approved questions for reuse.
- **Game builder / show runner:** Assemble rounds and operate a ~50–60-question live event with Spotify playback.
- **Physical buzzer system:** ESP32-C3 team controllers with four numbered arcade buttons each; ESP-NOW receiver connected to host laptop via USB serial. Local buzzer arbitration and game integration are planned, not confirmed implemented.
- **Recording-level classification:** Explore original release year/decade/genre with provenance and confidence/manual review; do not infer original year directly from ISRC.
- **Host review and question-quality improvements:** Better diversity, difficulty balance, distractors, and rejection/approval workflow.
- **Minimal guest phone usage:** Physical controls preferred for live participation.

## Operational notes
- Development environment: Windows 11, VS Code, TypeScript, Spicetify, Cloudflare Wrangler.
- Local Worker development has used `npx wrangler dev` and `http://localhost:8787/api/ai`.
- Representative test recording: `GBUM71029622` (Queen / David Bowie — “Under Pressure”).
- Representative generation check in Spotify DevTools:
```javascript
const result = await TriviaAdmin.generateQuestions("GBUM71029622");
console.log("Prompt length:", result.promptLength);
console.log("Validation:", result.validation);
console.log("Rejected:", result.validation.results.filter(r => !r.valid));
```
- A previous full playlist import contained 141 entries, 139 unique recordings, and 97 artists. This was a specific test, not a fixed product constraint.

## Next steps
1. Verify Milestone 8 is committed and repository is clean.
2. Add `AGENTS.md` and this context document to Git.
3. Decide and scope the next functional milestone, keeping question quality and planned D1/game features separate from already-completed grounding work.
4. Update this document as actual implementations are verified.
