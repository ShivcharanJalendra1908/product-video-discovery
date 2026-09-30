// Image "brain": runs fully locally with CLIP (transformers.js). No API key needed.
// The model (~150 MB) downloads once on first use and is cached on disk.
import { pipeline, env, AutoTokenizer, CLIPTextModelWithProjection } from '@xenova/transformers';
env.cacheDir = process.env.MODEL_CACHE || './.cache'; // where the CLIP model is stored
const MODEL = 'Xenova/clip-vit-base-patch32';
let embedder, classifier;
const getEmbedder = async () => (embedder ||= await pipeline('image-feature-extraction', MODEL));
const getClassifier = async () => (classifier ||= await pipeline('zero-shot-image-classification', MODEL));
export const words = s => (s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];

// Candidate labels for zero-shot attribute extraction (extend freely).
const LABELS = {
  type: ['t-shirt', 'hoodie', 'dress', 'jacket', 'jeans', 'sneakers', 'shoes', 'handbag', 'watch', 'jewelry', 'sunglasses', 'chocolate bar', 'protein bar', 'snack packet', 'bottle', 'cosmetics', 'skincare jar', 'phone case', 'headphones', 'furniture', 'toy'],
  colors: ['black', 'white', 'grey', 'red', 'blue', 'green', 'yellow', 'brown', 'pink', 'purple', 'orange', 'beige'],
  graphics: ['graphic print', 'plain with no print', 'logo', 'text lettering', 'pattern'],
  material: ['cotton fabric', 'leather', 'metal', 'plastic', 'glass', 'wood', 'paper packaging'],
};
const top = (res, n = 1) => res.slice(0, n).map(r => r.label);

const normalize = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const embed = async url => normalize(Array.from((await (await getEmbedder())(url)).data));
const embCache = new Map();
const productEmb = async url => embCache.get(url) || (embCache.set(url, await embed(url)), embCache.get(url));

// Text embedding: lets a name-only search (no product image) be compared with video thumbnails.
let tok, tm;
const embedText = async t => {
  tok ||= await AutoTokenizer.from_pretrained(MODEL); tm ||= await CLIPTextModelWithProjection.from_pretrained(MODEL);
  return normalize(Array.from((await tm(tok(`a photo of ${t}`, { padding: true, truncation: true }))).text_embeds.data));
};
const acache = new Map();
export async function analyze(p) {
  const key = p.image || p.title; if (acache.has(key)) return acache.get(key);
  const a = { type: '', colors: [], graphics: '', material: '' };
  if (p.image) try {
    const clf = await getClassifier(), run = l => clf(p.image, l, { hypothesis_template: 'a photo of {}' });
    [a.type] = top(await run(LABELS.type)); a.colors = top(await run(LABELS.colors), 2);
    [a.graphics] = top(await run(LABELS.graphics)); [a.material] = top(await run(LABELS.material));
  } catch (e) { console.error('CLIP analysis failed:', e.message); }
  const t = p.title || a.type, w = words(p.title);
  // Turn the attributes into platform-specific search queries and hashtags.
  a.queries = [...new Set([t, `${a.colors[0] || ''} ${a.type}`.trim(), `${t} ad`, `buy ${t}`, `${a.type} ${a.graphics}`.trim()])].filter(Boolean);
  a.hashtags = [...new Set([w.join(''), (a.type || '').replace(/\W/g, ''), ...w.slice(0, 3)])].filter(Boolean);
  acache.set(key, a); return a;
}

export function toScore(cos, hit, total, mode = 'image') {
  const text = total ? Math.min(1, hit / total) : 0;
  if (cos == null) return { score: Math.min(40, Math.round(text * 100)), reason: `No image comparison possible; ${hit}/${total} product words in caption`, mode: 'none' };
  const [lo, span] = mode === 'text' ? [0.24, 0.08] : [0.45, 0.35];
  const visual = Math.max(0, Math.min(1, (cos - lo) / span));
  const label = visual > 0.75 ? 'Very close visual match' : visual > 0.5 ? 'Similar look' : 'Weak visual match';
  return { score: Math.round(100 * (0.85 * visual + 0.15 * text)), reason: `${label} (CLIP ${mode} similarity ${cos.toFixed(2)}); caption has ${hit}/${total} product words`, mode };
}
export async function score(product, v) {
  const pw = words(product.title), hit = words(v.caption).filter(w => pw.includes(w)).length;
  let cos = null, mode = 'image';
  try {
    if (v.thumbnail && product.image) cos = dot(await productEmb(product.image), await embed(v.thumbnail));
    else if (v.thumbnail && product.title) { mode = 'text'; cos = dot(await embedText(product.title), await embed(v.thumbnail)); }
  } catch { /* thumbnail unreachable or model unavailable: caption-only score */ }
  return toScore(cos, hit, pw.length, mode);
}
