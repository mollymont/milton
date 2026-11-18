# Repository instructions

Follow the Git workflow in [CONTRIBUTING.md](CONTRIBUTING.md) unless the user explicitly directs otherwise.

1. Before editing, check the current branch and working tree with `git status --short --branch`. Preserve existing history, configuration, and uncommitted work.
2. Keep `main` stable. Start a short-lived, appropriately named branch for substantial work. Group related changes on it.
3. Implement incrementally and run the relevant tests and checks. Review the diff for correctness and sensitive information before staging. Stage only task-related changes. Verify Git author information and ask the user to configure missing identity fields.
4. Create focused Conventional Commits when a coherent unit is complete. Use concise imperative subjects and add a body where helpful.
5. Report commit hashes and subjects, test results, and final repository status.

Ask for explicit permission before configuring a remote, creating a remote repository, merging, pushing, publishing releases, or rewriting published history. Prefer squash merging through pull requests once GitHub is configured. Never force-push to `main`.
