// Service worker: all GitHub API traffic lives here (token never touches the page).
const API = "https://api.github.com";

async function settings() {
  const { token = "", method = "squash", bot = "greptile" } = await chrome.storage.local.get([
    "token",
    "method",
    "bot",
  ]);
  return { token, method, bot };
}

async function gh(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function graphql(query, token) {
  const r = await gh("/graphql", { method: "POST", body: { query }, token });
  if (!r.ok || !r.data.data?.repository) {
    const hint = r.status === 401 ? " (bad token)" : "";
    throw new Error(
      (r.data.message || r.data.errors?.[0]?.message || `GraphQL ${r.status}`) + hint,
    );
  }
  return r.data.data;
}

const SCORE_RE = /Confidence Score:\s*(\d)\s*\/\s*5/i;

function findScore(pr, bot) {
  const re = new RegExp(bot, "i");
  const all = [...(pr.reviews?.nodes || []), ...(pr.comments?.nodes || [])];
  let best = null;
  for (const n of all) {
    if (!n?.author || !re.test(n.author.login)) continue;
    const m = SCORE_RE.exec(n.body || "");
    if (!m) continue;
    // Prefer the most recently updated one.
    if (!best || (n.updatedAt || n.createdAt) >= best.at) {
      best = { score: Number(m[1]), url: n.url, at: n.updatedAt || n.createdAt };
    }
  }
  return best;
}

async function loadPRs({ owner, repo, numbers }) {
  const { token, bot } = await settings();
  if (!token) return { error: "no-token" };

  const fields = `number state isDraft mergeable baseRefName
    comments(last:50){nodes{author{login} body url createdAt updatedAt}}
    reviews(last:20){nodes{author{login} body url createdAt updatedAt}}
    commits(last:1){nodes{commit{statusCheckRollup{state}}}}`;
  const q = `query{repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}){${numbers
    .map((n) => `p${n}:pullRequest(number:${n}){${fields}}`)
    .join(" ")}}}`;

  const [data, stacksRes] = await Promise.all([
    graphql(q, token),
    gh(`/repos/${owner}/${repo}/stacks?per_page=100`, { token }).catch(() => null),
  ]);

  const prs = {};
  for (const pr of Object.values(data.repository || {})) {
    if (!pr) continue;
    const s = findScore(pr, bot);
    prs[pr.number] = {
      state: pr.state, // OPEN | MERGED | CLOSED
      draft: pr.isDraft,
      mergeable: pr.mergeable,
      checks: pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null,
      score: s?.score ?? null,
      scoreUrl: s?.url ?? null,
    };
  }

  // PR number -> { number, prs:[bottom..top], index }
  const stacks = {};
  if (stacksRes?.ok && Array.isArray(stacksRes.data)) {
    for (const st of stacksRes.data) {
      const list = (st.pull_requests || []).filter((p) => !p.merged_at);
      const nums = list.map((p) => p.number);
      nums.forEach((n, i) => {
        stacks[n] = { number: st.number, prs: nums, index: i };
      });
    }
  }
  return { prs, stacks };
}

async function mergePR({ owner, repo, number, stacked }) {
  const { token, method } = await settings();
  if (!token) return { error: "no-token" };
  const base = `/repos/${owner}/${repo}/pulls/${number}`;

  if (!stacked) {
    const r = await gh(`${base}/merge`, { method: "PUT", body: { merge_method: method }, token });
    return r.ok ? { ok: true } : { error: r.data.message || `HTTP ${r.status}` };
  }

  const r = await gh(`${base}/merge-async`, {
    method: "PUT",
    body: { merge_method: method, merge_action: "default" },
    token,
  });
  if (!r.ok) return { error: r.data.message || `HTTP ${r.status}` };
  let res = r.data;
  const uuid = res.details?.uuid;
  for (let i = 0; res.status === "pending" && uuid && i < 30; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const p = await gh(`${base}/merge-async/${uuid}`, { token });
    if (p.ok) res = p.data;
  }
  if (res.status === "merged") return { ok: true };
  if (res.status === "enqueued") return { ok: true, queued: true };
  if (res.status === "pending") return { ok: true, queued: true };
  return { error: res.details?.message || "Merge failed" };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  const run = { load: loadPRs, merge: mergePR }[msg.type];
  if (msg.type === "options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!run) return;
  run(msg).then(send, (e) => send({ error: String(e.message || e) }));
  return true; // async response
});
