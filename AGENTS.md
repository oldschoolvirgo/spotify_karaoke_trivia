# Codex Instructions — SYHO Music Trivia

## Read first
- Read `docs/PROJECT_CONTEXT.md` for project background, implementation status, and roadmap before substantial changes.
- Inspect the actual code before assuming a documented behavior is implemented. Code and tests take precedence over historical notes.
- Keep `docs/PROJECT_CONTEXT.md` current when architecture, milestone status, or major decisions change.

## Repository layout
- `triviaAdmin.ts` — Spicetify/Spotify trivia administration logic (repository root).
- `src/index.ts` — Cloudflare Worker HTTP endpoints and Workers AI invocation.
- `wrangler.jsonc` — Worker configuration.
- `worker-configuration.d.ts` — Wrangler-generated types; do not hand-edit.
- `80s-trivia-enriched.json` — Existing trivia data artifact; inspect before modifying.
- `playlistNormalization.txt` — Existing normalization notes/artifact; inspect before modifying.
- `README.md`, `package.json`, `tsconfig.json` — Existing project configuration and documentation.

## Working style
- Make focused, incremental changes scoped to the requested milestone; avoid opportunistic refactors or UI polish.
- Explain proposed changes briefly, then implement and verify. Prefer one actionable step at a time when collaborating interactively.
- Preserve working integrations and existing data formats unless a change is explicitly requested.
- Prefer a quick Git checkpoint, integrated test, and rollback if necessary while the project remains pre-production; do not substitute exhaustive manual deployment rituals for useful automated checks.
- Do not claim tests passed unless they were actually run. Report commands and outcomes clearly.
- Do not commit or deploy without an explicit request.

## Trivia generation invariants
- Spotify playlist entries and canonical recordings are distinct concepts; preserve duplicate playlist entries while deduplicating recording identity appropriately.
- ISRC identifies a recording, not necessarily the song's original release year.
- Keep authoritative source material separate from AI-generated candidates.
- Biography `sourceFact.value` must exactly match an authorized supplied `sourceText` and occur in the full authoritative biography. Do not loosen grounding checks merely to improve pass rate.
- Respect the Worker prompt limit (20,000 characters) and the client-side generation prompt budget (currently 18,000 characters); validate both when editing prompts.
- Treat AI output as untrusted candidate data: deterministic validation and human review are required before approval/publication.
- Keep model selection and Workers AI calls server-side in `src/index.ts`; avoid exposing private credentials in client code.

## Development and verification
- Inspect `package.json` for available scripts rather than assuming script names.
- For Worker changes, test `/health` and `/api/ai` via local Wrangler when feasible; inspect both HTTP status and model response content.
- For `triviaAdmin.ts` changes, test representative recording(s), prompt length, candidate counts, and validation rejection reasons in the Spicetify environment.
- Run appropriate type/syntax checks and `git diff --check` before proposing a commit.
- Avoid printing or committing secrets, private keys, or environment credentials.

## Documentation maintenance
- Update `docs/PROJECT_CONTEXT.md` when a milestone is completed, a planned feature becomes implemented, or a key architectural decision changes.
- Keep this file short; put history and roadmap in `docs/PROJECT_CONTEXT.md` rather than expanding agent instructions indefinitely.
