import dns from 'node:dns/promises';
import { dedupe } from './dedup.js';
import { analyze, score } from './brain.js';
const E = process.env, THRESH = +(E.MATCH_THRESHOLD || 45), MIN = 20;
const retry = async (fn, n = 3) => { for (let i = 0; ; i++) try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await new Promise(r => setTimeout(r, 800 * 2 ** i)); } };
async function mapLimit(a, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < a.length) { const k = i++; out[k] = await fn(a[k]); } })); return out; }

// ---- security: block non-http(s) and private/internal addresses (SSRF) ----
const priv = ip => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/i.test(ip);
export async function safeUrl(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs allowed');
  if ((await dns.lookup(url.hostname, { all: true })).some(a => priv(a.address))) throw new Error('Blocked internal address');
  return url.href;
}
const meta = (h, p) => (h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, 'i')) || [])[1];
const cache = new Map();
async function resolveProduct(u) {
  if (cache.has(u)) return cache.get(u);
  const href = await safeUrl(u);
  const html = await (await fetch(href, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  const p = { title: meta(html, 'og:title') || (html.match(/<title>([^<]+)/i) || [])[1] || '', description: meta(html, 'og:description') || '', image: meta(html, 'og:image') };
  p.title ||= new URL(href).pathname.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || new URL(href).hostname; // fallback title
  if (p.image) p.image = new URL(p.image, href).href;
  cache.set(u, p); return p;
}

// ---- collectors (Apify actors; deterministic mock when APIFY_TOKEN is missing) ----
const apify = async (actor, input) => { const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${E.APIFY_TOKEN}`, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); if (!r.ok) throw new Error(`Apify ${r.status}`); return r.json(); };
const rnd = () => Math.random().toString(36).slice(2);
const mock = (src, q, title = q) => Array.from({ length: 25 }, (_, i) => ({ id: `${src}:${q}-${i}`, platform: src, url: 'https://example.com', thumbnail: `https://picsum.photos/seed/${src}${q}${i}/300/400`, caption: `${title} ${q} demo clip ${rnd()} ${rnd()}`, date: Date.now() - i * 864e5 }));
const FETCH = {
  instagram: async (q, t) => !E.APIFY_TOKEN ? mock('instagram', q, t) : (await apify(E.APIFY_IG_ACTOR || 'data-slayer~instagram-search-reels', { search: q, maxItems: 30 }))
    .filter(x => x.video_url).map(x => ({ id: 'instagram:' + x.code, platform: 'instagram', url: 'https://instagram.com/reel/' + x.code, videoUrl: x.video_url, thumbnail: x.thumbnail_url, caption: x.caption?.text || '', date: (x.taken_at_ts * 1000) || 0 })),
  meta: async (q, t) => !E.APIFY_TOKEN ? mock('meta', q, t) : (await apify(E.APIFY_META_ACTOR || 'curious_coder~facebook-ads-library-scraper', { urls: [{ url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&media_type=video&q=${encodeURIComponent(q)}` }], count: 60 }))
    .filter(x => x.snapshot?.videos?.length).map(x => ({ id: 'meta:' + x.ad_archive_id, platform: 'meta', url: `https://www.facebook.com/ads/library/?id=${x.ad_archive_id}`, videoUrl: x.snapshot.videos[0].video_hd_url || x.snapshot.videos[0].video_sd_url || null, thumbnail: x.snapshot.videos[0].video_preview_image_url, caption: x.snapshot.body?.text || x.snapshot.title, date: Date.parse(x.start_date_string || x.start_date) || 0 })),
};
// Build a wider set of fallback queries when the initial set doesn't yield enough good results.
function fallbackQueries(src, product) {
  const ws = (product.title || '').toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const t = product.attrs?.type || '';
  if (src === 'instagram') return [...ws.slice(0, 4), t, `${t}style`, `${ws[0] || t}shop`].filter(Boolean);
  return [`buy ${product.title}`, `${t} ad`, `${product.title} review`, `${t} brand`, ...ws.map(w => `${w} product`)].filter(Boolean);
}

async function collect(src, product, seen, step) {
  const primaryQs = product.attrs.queries;
  const fallbackQs = fallbackQueries(src, product);
  let queriesTried = 0;

  let pool = [], d = { fresh: [], repeats: [] };

  // Pass 1 — primary queries: collect until we have a large-enough candidate pool.
  for (const q of primaryQs) {
    queriesTried++;
    try { pool.push(...await retry(() => FETCH[src](q, product.title))); } catch (e) { step(`${src} "${q}" failed: ${e.message}`); continue; }
    d = dedupe(pool, seen); step(`${src}: ${d.fresh.length} fresh after "${q}"`);
    if (d.fresh.length >= 55) break;
  }

  step(`Scoring ${src} (first pass, ${d.fresh.length} candidates)`);
  let scored = await mapLimit(d.fresh.slice(0, 60), 2, async v => { const s = await score(product, v); return { ...v, ...s, low: s.score < THRESH }; });
  let good = scored.filter(v => !v.low).length;

  // Pass 2 — if still short, try fallback queries until we reach MIN or exhaust options.
  if (good < MIN) {
    step(`${src}: only ${good}/${MIN} good — trying broader queries`);
    for (const q of fallbackQs) {
      if (good >= MIN) break;
      queriesTried++;
      try { pool.push(...await retry(() => FETCH[src](q, product.title))); } catch (e) { step(`${src} fallback "${q}" failed: ${e.message}`); continue; }
      d = dedupe(pool, seen);
      const newFresh = d.fresh.slice(scored.length);
      if (!newFresh.length) continue;
      const newScored = await mapLimit(newFresh.slice(0, 20), 2, async v => { const s = await score(product, v); return { ...v, ...s, low: s.score < THRESH }; });
      scored = [...scored, ...newScored];
      good = scored.filter(v => !v.low).length;
      step(`${src}: ${good}/${MIN} good after fallback "${q}"`);
    }
  }

  // Always surface the top MIN videos — items under threshold get "weak" label instead of hidden.
  const allScored = [...scored].sort((a, b) => b.score - a.score);
  allScored.slice(0, MIN).forEach(v => { if (v.low) { v.low = false; v.weak = true; } });
  good = allScored.filter(v => !v.low).length; // recount after promotion

  const items = [...allScored, ...d.repeats.map(v => ({ ...v, score: 0, reason: 'Seen in an earlier search', seenBefore: true }))];
  const shortfall = good < MIN
    ? `Only ${good}/${MIN} matching videos found — ${pool.length} candidates fetched across ${queriesTried} quer${queriesTried === 1 ? 'y' : 'ies'}. Add a product image URL for better matching.`
    : null;
  return { items, good, shortfall, _debug: { candidates: pool.length, queriesTried } };
}

export async function run(job, db, emit) {
  const step = m => { job.progress.push(m); emit(); };
  job.status = 'running'; step('Resolving product');
  let p = { title: job.input.query || '', description: '', image: job.input.imageUrl };
  if (job.input.url) p = { ...p, ...await resolveProduct(job.input.url) };
  step('Analysing product image'); job.product = { ...p, attrs: await analyze(p) };
  const seen = new Set(db.data.seen);
  const [ig, mt] = await Promise.allSettled(['instagram', 'meta'].map(s => collect(s, job.product, seen, step)));
  job.results = {};
  for (const [k, r] of [['instagram', ig], ['meta', mt]]) job.results[k] = r.status === 'fulfilled' ? r.value : { items: [], good: 0, shortfall: 'Source failed: ' + r.reason.message };
  for (const r of Object.values(job.results)) r.items.filter(v => !v.seenBefore && !v.low).forEach(v => db.data.seen.push(v.id));
  job.status = 'done'; step('Done');
}
