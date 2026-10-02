# Greptile Score

Chrome extension: on GitHub PR lists (e.g. `github.com/workos/riker/pulls`) shows each PR's Greptile
confidence score (`X/5`, links to the comment) plus a **Merge** / **Merge stack** button.

## Install
1. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this folder.
2. Options page opens via the "Set GitHub token" button on any PR list (or Details → Extension options).
   Paste a token (`gh auth token` works; authorize for SSO if your org needs it) and pick a merge method.

## Notes
- Score = latest `Confidence Score: X/5` in a comment/review by an author matching `greptile`.
- Stacked PRs (GitHub stacks API): top PR → "Merge stack"; lower PRs → "Merge 2/4", which merges that PR
  and everything below (`PUT /pulls/N/merge-async`, same as `gh stack merge`). Others use `PUT /pulls/N/merge`.
- Confirms before merging. Drafts and conflicting PRs are disabled; failing checks turn the button amber.
- Data is cached 60s per PR; reload the page to refresh.
