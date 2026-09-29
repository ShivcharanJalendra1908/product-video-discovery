import 'dotenv/config';
import express from 'express'; import cors from 'cors';
import fs from 'node:fs'; import crypto from 'node:crypto';
import { run, safeUrl } from './pipeline.js';
const F = 'data/db.json'; fs.mkdirSync('data', { recursive: true });
const db = { data: fs.existsSync(F) ? JSON.parse(fs.readFileSync(F)) : { searches: [], seen: [] } };
const save = () => fs.writeFileSync(F, JSON.stringify(db.data));
const jobs = new Map(), subs = new Map(); let active = 0; const queue = [];
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const pump = () => { while (active < 2 && queue.length) { const j = queue.shift(); active++;
  const emit = () => (subs.get(j.id) || []).forEach(r => r.write(`data: ${JSON.stringify(j)}\n\n`));
  run(j, db, emit).catch(e => { j.status = 'error'; j.error = e.message; log({ level: 'error', id: j.id, err: e.message }); })
    .finally(() => { active--; db.data.searches.unshift({ id: j.id, input: j.input, status: j.status, at: j.at, job: j }); save(); emit(); (subs.get(j.id) || []).forEach(r => r.end()); pump(); }); } };
const app = express(); app.use(cors(), express.json({ limit: '8mb' }));
// Uploaded images arrive as data: URLs; everything else must pass the SSRF check.
app.post('/api/search', async (req, res) => {
  const { query, url, imageUrl } = req.body || {};
  if (!query && !url && !imageUrl) return res.status(400).json({ error: 'Provide query, url or imageUrl' });
  try { if (url) await safeUrl(url); if (imageUrl && !imageUrl.startsWith('data:image/')) await safeUrl(imageUrl); } catch (e) { return res.status(400).json({ error: e.message }); }
  const job = { id: crypto.randomUUID(), input: { query: query?.slice(0, 200), url, imageUrl }, status: 'queued', progress: [], at: Date.now() };
  jobs.set(job.id, job); queue.push(job); pump(); log({ level: 'info', id: job.id, input: job.input }); res.status(202).json({ id: job.id });
});
const find = id => jobs.get(id) || db.data.searches.find(s => s.id === id)?.job;
app.get('/api/search/:id', (q, r) => find(q.params.id) ? r.json(find(q.params.id)) : r.status(404).json({ error: 'Not found' }));
app.get('/api/search/:id/events', (q, r) => { const j = find(q.params.id); if (!j) return r.sendStatus(404);
  r.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); r.write(`data: ${JSON.stringify(j)}\n\n`);
  if (['done', 'error'].includes(j.status)) return r.end(); (subs.get(j.id) || subs.set(j.id, []).get(j.id)).push(r); });
app.get('/api/history', (q, r) => r.json(db.data.searches.map(({ id, input, status, at }) => ({ id, input, status, at }))));
app.listen(process.env.PORT || 3001, () => log({ level: 'info', msg: 'listening' }));
