# Contributing

Use Node.js 24 or later. Run `npm test` before submitting a change. With Claude Code installed, run `npm run test:integration` for the CLI startup check. For native mod changes, prepare the plugins and run `claude plugin test` from `mod/` using a compatible CLI. The README describes which checks require a signed-in terminal.

## Git workflow

- Keep `main` stable. Use short-lived branches for substantial work, such as `feat/recommendation-engine`, `fix/snooze-persistence`, or `docs/installation`. Group related edits on the same branch and avoid a permanent development branch.
- Commit coherent changes after relevant tests and a diff review. Stage only files that belong to the change. Keep credentials, session transcripts, personal data, and unrelated work out of commits.
- Use Conventional Commits with an imperative subject, ideally under 72 characters. Use `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, or `ci` as appropriate. Add a body when context helps explain the change. Avoid generic subjects such as “updates” or “work in progress.”
- Once GitHub is configured, prefer squash merging completed pull requests into `main`. Never force-push to `main`. Rewriting published history requires explicit approval.
