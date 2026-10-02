# Greptile Score

A small Chrome extension that adds two things to every row of a GitHub pull request list
(e.g. `github.com/<owner>/<repo>/pulls`):

- the **[Greptile](https://greptile.com) confidence score** (`X/5`), colour-coded and linked to the review comment
- a **Merge** / **Merge stack** button, so you can land PRs without opening each one

No build step, no dependencies. Plain Manifest V3 JavaScript.

## Features

| | |
|---|---|
| Score badge | `5/5` green → `1/5` red. Grey `–/5` means Greptile hasn't posted a score yet. Click it to jump to the comment. |
| Merge button | Plain PRs get **Merge**. Calls the standard merge API using your chosen method. |
| Stacked PRs | Detected through GitHub's stacks API. The top PR gets **Merge stack**; lower PRs get **Merge 2/4**, which merges that PR *and everything below it*. |
| Safety | Always confirms first (showing score and check status). Drafts and PRs with conflicts are disabled. Failing checks turn the button amber. |
| Merged state | Rows flip to **Merged ✓** after a successful merge, including the PRs below it in a stack. |
| Works everywhere | Repo PR lists, and the global `github.com/pulls` dashboard (each row's repo is read from its link). |

## Install

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open any PR list. Click **Set GitHub token** on a row (or Details → *Extension options*) and configure the extension (below).

Works in any Chromium browser that supports MV3 (Chrome, Edge, Brave, Arc).

## Configuration

Open the options page and set:

### GitHub token (required)

The extension calls `api.github.com` from its background service worker. The token is stored in
`chrome.storage.local` on your machine and is never exposed to the page or sent anywhere except GitHub.

Easiest option, if you use the GitHub CLI:

```sh
gh auth token | pbcopy   # paste into the options page
```

Or create one yourself:

- **Classic PAT:** `repo` scope. For orgs with SAML SSO, click **Configure SSO** next to the token and authorize the org.
- **Fine-grained PAT:** set the resource owner to the org, select the repos, and grant *Pull requests: read & write*, *Contents: write* (needed to merge), and *Metadata: read*. Some orgs require an admin to approve fine-grained tokens.

Sanity check:

```sh
curl -s -H "Authorization: Bearer <token>" https://api.github.com/repos/<owner>/<repo> | head -3
```

### Merge method

`squash` (default), `merge`, or `rebase`. Used for both single and stack merges. It must be enabled on the repo.

### Greptile author pattern

A case-insensitive regex matched against the login of a PR comment/review author. Default: `greptile`,
which matches the `greptile-apps` bot. Change it only if Greptile posts under a different login
(e.g. a self-hosted bot). Use `^greptile-apps$` to be stricter.

## How it works

```
content.js ──message──▶ background.js ──fetch──▶ api.github.com
  (DOM + UI)             (token, API calls)
```

**Finding the score.** For each visible PR, one batched GraphQL query (aliased `pullRequest(number: N)`
fields) fetches the last 50 comments and last 20 reviews. The extension takes the most recently
updated one authored by the Greptile bot whose body matches `Confidence Score: X/5`. Greptile edits a
single summary comment in place, so this tracks re-reviews.

**Finding stacks.** `GET /repos/{owner}/{repo}/stacks` returns each stack's ordered PRs (bottom → top);
merged PRs are filtered out. This reads the first 100 stacks of the repo.

**Merging.**

- Not stacked: `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with `merge_method`.
- Stacked: `PUT /repos/{owner}/{repo}/pulls/{n}/merge-async` with `merge_action: "default"`, then polls
  `merge-async/{uuid}` for up to ~30s. This is the same endpoint `gh stack merge` uses. It merges the PR and every
  unmerged PR below it, all-or-nothing. If the base branch uses a merge queue, the stack is *enqueued* and the
  button shows a "Queued" tooltip instead of flipping to merged.

**Injecting into the page.** GitHub's PR list is a React app with hashed class names, so the extension anchors on
stable attributes: `a[data-testid="listitem-title-link"]` to find rows and
`[data-listview-item-title-container]` to place the widget. A debounced `MutationObserver` re-injects
after React re-renders or SPA navigation. Results are cached for 60 seconds per PR.

## Troubleshooting

Hover the red **error** badge, or check the page console for `[greptile-score]` lines.

| Message | Meaning / fix |
|---|---|
| **Set GitHub token** button | No token saved. Open the options page. |
| `Bad credentials` | Token is wrong, truncated, or revoked. Re-paste it and click **Save**. |
| `Could not resolve to a Repository` | The token is valid but can't see the repo: missing `repo` scope, SSO not authorized, or a fine-grained token not scoped to that org/repo. |
| `Extension context invalidated` / `Receiving end does not exist` | You reloaded the extension. Reload the GitHub tab too. |
| Grey `–/5` on a PR you expect to be scored | Greptile hasn't finished, or posts under a login that doesn't match the author pattern. |
| No widgets at all | GitHub may have changed its list markup. See [Selectors](#when-github-changes-its-markup). |
| Merge fails with a message | The message is GitHub's (branch protection, required checks, merge method disabled, etc.). |

### When GitHub changes its markup

The only DOM coupling is in `content.js`: the row selector (`a[data-testid="listitem-title-link"]`), the
`li` ancestor, and the title container (`[data-listview-item-title-container]`). Update those if the list stops
rendering widgets.

## Limitations

- Scores and state are cached for 60s; reload to refresh.
- Only the first 100 stacks per repo are considered.
- Only the first page of rows GitHub renders is annotated (scrolling/pagination re-scans automatically).
- Greptile's score is parsed from comment text, so a change to Greptile's summary format would require updating the regex in `background.js` (`SCORE_RE`).
- Merging is real. The confirm dialog is the only guard, so check before you click.

## Project layout

```
manifest.json   MV3 manifest (host permission: api.github.com; content script: github.com)
background.js   service worker: GraphQL/REST calls, score parsing, merge + polling
content.js      finds PR rows, renders badge/button, handles confirm + merge UI
content.css     badge and button styling
options.html/js token, merge method, Greptile author pattern
```

## Privacy

Your token lives in `chrome.storage.local`. The only network traffic is to `api.github.com`. There is no
analytics or third-party service.
