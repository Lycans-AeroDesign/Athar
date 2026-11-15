/** Line-level text diff for comparing article revisions. */

export type DiffLine = { type: "same" | "added" | "removed"; text: string };

/** A run of unchanged lines folded away by `withContext`. */
export type DiffGap = { type: "gap"; count: number };

// Above this many cells the LCS table gets too slow/large for the browser;
// the changed middle is then shown as "all removed, all added" instead.
const MAX_LCS_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");

  // Most edits touch a small part of a long article - strip the common
  // head and tail first so the LCS only runs over what actually changed.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ type: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ type: "same", text }));
  return [...head, ...diffMiddle(a.slice(start, endA), b.slice(start, endB)), ...tail];
}

function diffMiddle(a: string[], b: string[]): DiffLine[] {
  const removedAll = a.map((text): DiffLine => ({ type: "removed", text }));
  const addedAll = b.map((text): DiffLine => ({ type: "added", text }));
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_LCS_CELLS) {
    return [...removedAll, ...addedAll];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const cols = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        a[i] === b[j] ? lcs[(i + 1) * cols + j + 1] + 1 : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      out.push({ type: "removed", text: a[i++] });
    } else {
      out.push({ type: "added", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ type: "removed", text: a[i++] });
  while (j < b.length) out.push({ type: "added", text: b[j++] });
  return out;
}

/** Keeps `context` unchanged lines around each change and folds every
 * longer unchanged run into a single gap marker. */
export function withContext(lines: DiffLine[], context = 3): (DiffLine | DiffGap)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.type === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) {
      keep[k] = true;
    }
  });

  const out: (DiffLine | DiffGap)[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) out.push({ type: "gap", count: skipped });
      skipped = 0;
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) out.push({ type: "gap", count: skipped });
  return out;
}
