// Injects a Greptile score badge + merge button into GitHub PR list rows.
const TTL = 60_000;
const cache = new Map(); // "owner/repo#n" -> { at, pr, stack }
const inflight = new Set();
let timer = null;

const send = (m) => chrome.runtime.sendMessage(m);
const keyOf = (r, n) => `${r.owner}/${r.repo}#${n}`;

function parseRow(li) {
  const a = li.querySelector('a[data-testid="listitem-title-link"]');
  const m = a && /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(new URL(a.href).pathname);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]), li } : null;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function render(row) {
  const { li } = row;
  const container = li.querySelector("[data-listview-item-title-container]");
  if (!container) return;
  let w = container.querySelector(":scope > .gs-widget");
  if (!w) {
    w = el("span", "gs-widget");
    container.append(w);
  }
  const entry = cache.get(keyOf(row, row.number));
  w.replaceChildren();
  if (!entry) return w.append(el("span", "gs-badge gs-none", "…"));
  if (entry.error === "no-token") {
    const b = el("button", "gs-btn gs-warn", "Set GitHub token");
    b.onclick = (e) => (e.preventDefault(), e.stopPropagation(), send({ type: "options" }));
    return w.append(b);
  }
  if (entry.error) {
    const b = el("span", "gs-badge gs-none", "error");
    b.title = entry.error;
    return w.append(b);
  }

  const { pr, stack } = entry;
  if (!pr) return;

  const badge = pr.score == null ? el("span", "gs-badge gs-none", "–/5") : el("a", "gs-badge", `${pr.score}/5`);
  if (pr.score != null) {
    badge.dataset.score = pr.score;
    badge.href = pr.scoreUrl;
    badge.title = "Greptile confidence score";
  } else badge.title = "No Greptile score yet";
  w.append(badge);

  if (pr.state === "MERGED") return w.append(el("span", "gs-btn gs-done", "Merged ✓"));
  if (pr.state !== "OPEN") return;

  const stacked = !!stack;
  const isTop = stacked && stack.index === stack.prs.length - 1;
  const label = !stacked ? "Merge" : isTop ? "Merge stack" : `Merge ${stack.index + 1}/${stack.prs.length}`;
  const btn = el("button", "gs-btn", label);
  if (entry.busy) {
    btn.textContent = "Merging…";
    btn.disabled = true;
  } else if (pr.draft) {
    btn.textContent = "Draft";
    btn.disabled = true;
  } else if (pr.mergeable === "CONFLICTING") {
    btn.textContent = "Conflicts";
    btn.disabled = true;
  } else {
    if (pr.checks === "FAILURE" || pr.checks === "ERROR") btn.classList.add("gs-warn");
    btn.title = stacked
      ? `Merge this PR and the ${stack.index} below it (stack #${stack.number})`
      : "Merge pull request";
    btn.onclick = (e) => (e.preventDefault(), e.stopPropagation(), doMerge(row, entry));
  }
  if (entry.msg) btn.title = entry.msg;
  w.append(btn);
}

async function doMerge(row, entry) {
  const { pr, stack } = entry;
  const lines = [
    `Merge ${row.owner}/${row.repo}#${row.number}?`,
    stack ? `\nThis merges ${stack.index + 1} PR(s) in stack #${stack.number}, bottom up.` : "",
    `\nGreptile: ${pr.score == null ? "no score" : pr.score + "/5"}`,
    pr.checks && pr.checks !== "SUCCESS" ? `Checks: ${pr.checks}` : "",
  ];
  if (!confirm(lines.filter(Boolean).join("\n"))) return;

  entry.busy = true;
  renderAll();
  const res = await send({ type: "merge", ...row, li: undefined, stacked: !!stack });
  entry.busy = false;
  if (res?.ok) {
    const merged = stack ? stack.prs.slice(0, stack.index + 1) : [row.number];
    for (const n of merged) {
      const e = cache.get(keyOf(row, n));
      if (e?.pr) e.pr.state = res.queued ? e.pr.state : "MERGED";
    }
    if (res.queued) entry.msg = "Queued — will merge shortly";
  } else {
    entry.msg = res?.error || "Merge failed";
    alert(`Merge failed: ${entry.msg}`);
  }
  renderAll();
}

let rows = [];
function renderAll() {
  rows.forEach(render);
}

async function fetchRepo(owner, repo, numbers) {
  numbers.forEach((n) => inflight.add(keyOf({ owner, repo }, n)));
  let res;
  try {
    res = await send({ type: "load", owner, repo, numbers });
  } catch (e) {
    res = { error: String(e.message || e) + " (reload the page after reloading the extension)" };
  }
  if (res?.error) console.error("[greptile-score]", owner + "/" + repo, res.error);
  for (const n of numbers) {
    const k = keyOf({ owner, repo }, n);
    inflight.delete(k);
    if (res?.error || !res?.prs?.[n]) cache.set(k, { at: Date.now(), error: res?.error || "missing" });
    else cache.set(k, { at: Date.now(), pr: res.prs[n], stack: res.stacks?.[n] });
  }
  renderAll();
}

function scan() {
  rows = [...document.querySelectorAll("li")]
    .filter((li) => li.querySelector('a[data-testid="listitem-title-link"]'))
    .map(parseRow)
    .filter(Boolean);
  rows.forEach(render);

  const need = {};
  for (const r of rows) {
    const k = keyOf(r, r.number);
    const e = cache.get(k);
    if (inflight.has(k) || (e && Date.now() - e.at < TTL)) continue;
    (need[`${r.owner}/${r.repo}`] ||= []).push(r.number);
  }
  for (const [slug, nums] of Object.entries(need)) {
    const [owner, repo] = slug.split("/");
    fetchRepo(owner, repo, nums);
  }
}

const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(scan, 150);
};
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
schedule();
