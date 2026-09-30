# AiWorkShop

Workshop deck (desktop, presenter screen) + participant phone page (iPhone-first), published via GitHub Pages from `docs/`.

## Rules
- All user-facing text lives in `content/*.md` (one file per slide, `## field` sections). Never hardcode copy in `src/*.html`; add a field and reference it as `{{file-id.field}}`.
- `docs/` is build output. Edit `src/` + `content/`, then `pnpm run build`. `pnpm run deploy` builds, commits and pushes.
- Deck targets desktop only (min-width 1100px). The phone page (`src/join.html`) must work on iOS Safari: inputs >= 16px, safe-area insets, no hover-only actions.
- Max font weight 500 (Tajawal 300/400/500). Colors: MoE brand guide 2025 tokens in `:root`.
- Arabic copy follows the stop-slop Arabic rules: no em dash, straight quotes "...", no filler. Audience is female teachers, but keep buttons and instructions gender-neutral (verbal nouns: إرسال، نسخ، بدء); feminine only where factual (المتدربات، الطالبات).
- Supabase project `dqedhfwaquqaddbtfvtx` (QProjects) is shared with other apps. Only touch objects prefixed `aiws_`. Presenter actions go through `aiws_*` RPCs that check the room secret.
- Presenter notes page: `src/notes.html` → `docs/notes/`, gated by the presenter key via `aiws_verify`; timings from `content/21-presenter-page.md`. It follows the deck's slide over a key-derived realtime channel; the presenter only reveals that slide's notes one by one (Space/↓), with ←/→ as a backup remote for the deck.
- Presenter notes format: each slide file's `## notes` is an ordered list, one line per note: `- type | text`, in delivery order. Types (`say`, `do`, `ask`, `watch`, `go`) are declared in `presenter-page.note_types`; an unknown type fails the build. End each slide with a `go` line (the bridge sentence to the next slide). Notes address the presenter (masculine imperative); quoted lines are what he says to the audience.
- Live reactions (phone bottom bar: agree, disagree, raise hand) use no tables: thumbs are Realtime broadcast events (`react`) and raised hands are presence metadata (`hand`, `ht`) on the `aiws-room-<room>` channel; the deck lowers hands with a `lower` broadcast. They are ephemeral by design and never reach the export.
- `secrets/` (presenter key) is gitignored. Never commit it or print it into built files.
