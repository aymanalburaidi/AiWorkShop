# AiWorkShop

Workshop deck (desktop, presenter screen) + participant phone page (iPhone-first), published via GitHub Pages from `docs/`.

## Rules
- All user-facing text lives in `content/*.md` (one file per slide, `## field` sections). Never hardcode copy in `src/*.html`; add a field and reference it as `{{file-id.field}}`.
- `docs/` is build output. Edit `src/` + `content/`, then `pnpm run build`. `pnpm run deploy` builds, commits and pushes.
- Deck targets desktop only (min-width 1100px). The phone page (`src/join.html`) must work on iOS Safari: inputs >= 16px, safe-area insets, no hover-only actions.
- Max font weight 500 (Tajawal 300/400/500). Colors: MoE brand guide 2025 tokens in `:root`.
- Arabic copy follows the stop-slop Arabic rules: no em dash, straight quotes "...", no filler. Audience is female teachers, but keep buttons and instructions gender-neutral (verbal nouns: إرسال، نسخ، بدء); feminine only where factual (المتدربات، الطالبات).
- Supabase project `dqedhfwaquqaddbtfvtx` (QProjects) is shared with other apps. Only touch objects prefixed `aiws_`. Presenter actions go through `aiws_*` RPCs that check the room secret.
- Presenter notes page: `src/notes.html` → `docs/notes/`, gated by the presenter key via `aiws_verify`; per-slide notes come from each file's `## notes`, timings from `content/21-presenter-page.md`. It syncs with the deck over a key-derived realtime channel.
- `secrets/` (presenter key) is gitignored. Never commit it or print it into built files.
