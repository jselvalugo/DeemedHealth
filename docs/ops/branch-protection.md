# Branch protection: manual GitHub settings

Owner: `platform-devops-engineer`. Applied by: the repository admin (product
owner @jselvalugo, decision D5). Roadmap §3 requires that `main` cannot be pushed
to directly and that CI blocks. These settings cannot be set from a file in the
repo; turn them on by hand and record the date below.

## 1. Ruleset for `main`

Settings > Rules > Rulesets > New branch ruleset.

- Name: `main-protection`; Enforcement status: **Active**.
- Bypass list: **empty** (no admin bypass).
- Target branches: **Include default branch**.
- Turn on:
  - **Restrict deletions**
  - **Block force pushes**
  - **Require linear history**
  - **Require signed commits**
  - **Require a pull request before merging**
    - Required approvals: **1** (raise to 2 when there are two maintainers)
    - **Dismiss stale pull request approvals when new commits are pushed**
    - **Require review from Code Owners**
    - **Require approval of the most recent reviewable push**
    - **Require conversation resolution before merging**
    - Allowed merge methods: **Squash** only
  - **Require status checks to pass**
    - **Require branches to be up to date before merging**
    - Required checks (job names from `.github/workflows/ci.yml`, source GitHub Actions):
      - `lint-typecheck-test`
      - `dependency-review`
      - `secret-scan`
      - `codeql`
  - **Require code scanning results**: tool `CodeQL`, alerts **Errors**, security alerts **High or higher**.
- Leave "Restrict creations" and "Restrict updates" off (the PR rule already blocks direct pushes).

## 2. Repository settings

Settings > General:
- Pull Requests: allow **squash merging** only; turn on **Always suggest updating pull request branches** and **Automatically delete head branches**.

Settings > Actions > General:
- Actions permissions: **Allow select actions**: GitHub-created actions plus
  `pnpm/action-setup@*` and `gitleaks/gitleaks-action@*`.
- **Require actions to be pinned to a full-length commit SHA**: on.
- Workflow permissions: **Read repository contents** (read-only `GITHUB_TOKEN`);
  **do not** allow Actions to create or approve pull requests.
- Fork pull request workflows: **Require approval for all outside collaborators**.

Settings > Code security:
- Dependency graph: on. Dependabot alerts: on. Dependabot security updates: on.
- Secret scanning: on. **Push protection**: on.
- Code scanning: CodeQL runs from `ci.yml`; leave default setup **off** to avoid double runs.

Settings > Secrets and variables > Actions:
- Add `GITLEAKS_LICENSE` if the repo is owned by an organization.

Settings > Environments:
- Create `production` with **Required reviewers** (@jselvalugo), **Prevent self-review**,
  and deployment branches limited to tags matching `v*`. Create `staging` limited to `main`.

## 3. Tags

Settings > Rules > Rulesets > New tag ruleset `release-tags`, target `v*`:
Restrict creations to maintainers, Restrict updates, Restrict deletions, Require signed commits.

## 4. Verify

- `git push origin main` from a local clone is rejected.
- A PR with a failing `lint-typecheck-test` cannot be merged.
- An unsigned commit on a PR blocks merging.

## Record

| Date | Applied by | Notes |
| --- | --- | --- |
| | | |
