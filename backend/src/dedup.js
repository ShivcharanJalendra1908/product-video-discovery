export const tokens = s => new Set((s || '').toLowerCase().replace(/https?:\S+/g, '').match(/[a-z0-9\u0900-\u097f]{3,}/g) || []);
export const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; const u = a.size + b.size - i; return u ? i / u : 0; };
// Removes: already-seen ids (returned separately), same-id repeats, near-duplicate captions (Jaccard >= thr = reposts / same ad, new ID).
export function dedupe(items, seen = new Set(), thr = 0.85) {
  const fresh = [], repeats = [], sigs = [], ids = new Set();
  for (const v of items) {
    if (ids.has(v.id)) continue; ids.add(v.id);
    if (seen.has(v.id)) { repeats.push(v); continue; }
    const t = tokens(v.caption);
    if (t.size >= 8 && sigs.some(s => jaccard(s, t) >= thr)) continue;
    sigs.push(t); fresh.push(v);
  }
  return { fresh, repeats };
}
