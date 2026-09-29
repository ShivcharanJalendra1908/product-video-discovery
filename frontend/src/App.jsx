import { useState, useEffect, useRef } from 'react';

const API = '/api';

export default function App() {
  const [text,     setText]     = useState('');
  const [img,      setImg]      = useState('');
  const [job,      setJob]      = useState(null);
  const [err,      setErr]      = useState('');
  const [stars,    setStars]    = useState({});
  const [tab,      setTab]      = useState('instagram');
  const [sort,     setSort]     = useState('score');
  const [showLow,  setShowLow]  = useState(false);
  const [showSeen, setShowSeen] = useState(false);
  const [hist,     setHist]     = useState([]);
  const [playing,  setPlaying]  = useState(null);
  const esRef = useRef(null);

  const loadHist = () =>
    fetch(`${API}/history`).then(r => r.json()).then(setHist).catch(() => {});

  useEffect(() => { loadHist(); }, []);

  const open = id => {
    setJob(null); setStars({}); setPlaying(null);
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${API}/search/${id}/events`);
    esRef.current = es;
    es.onmessage = e => {
      const j = JSON.parse(e.data);
      setJob(j);
      if (j.status === 'done' || j.status === 'error') { es.close(); loadHist(); }
    };
    es.onerror = () => es.close();
  };

  const go = async () => {
    const q = text.trim();
    if (!q && !img) { setErr('Enter a product name, URL, or upload an image.'); return; }
    setErr('');
    const isUrl = /^https?:\/\//i.test(q);
    const body = {
      [isUrl ? 'url' : 'query']: q || undefined,
      imageUrl: img.trim() || undefined,
    };
    try {
      const r = await fetch(`${API}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok) open(j.id);
      else setErr(j.error || 'Search failed. Please try again.');
    } catch {
      setErr('Could not reach the server. Make sure the backend is running.');
    }
  };

  const exportCsv = () => {
    const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const rows = Object.values(stars).filter(Boolean);
    if (!rows.length) return;
    const csv = [
      'platform,url,score,caption,reason',
      ...rows.map(v => [v.platform, v.url, v.score, v.caption, v.reason].map(q).join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `shortlist-${Date.now()}.csv`;
    a.click();
  };

  const res       = job?.results?.[tab];
  const starCount = Object.values(stars).filter(Boolean).length;

  const items = (res?.items || [])
    .filter(v => (showLow || !v.low) && (showSeen || !v.seenBefore))
    .sort((a, b) => sort === 'score' ? b.score - a.score : (b.date || 0) - (a.date || 0));

  const isRunning = job && job.status !== 'done' && job.status !== 'error';

  /* ── Render ─────────────────────────────────────── */
  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <h1>🎬 Product Video Discovery</h1>
        <p className="subtitle">
          Find Instagram Reels &amp; Meta Ad videos that match any product — powered by local CLIP vision AI
        </p>
      </header>

      {/* ── Search ── */}
      <section className="search-section">
        <div className="search-box">
          <div className="search-row">
            <input
              id="search-input"
              className="search-input"
              placeholder="Product name or URL  (e.g. 'oversized graphic tee' or https://…)"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && go()}
            />
            <button id="search-btn" className="btn btn-primary" onClick={go}>
              🔍 Search
            </button>
          </div>

          <div className="search-extras">
            <input
              id="image-url-input"
              className="input-secondary"
              placeholder="Optional: product image URL"
              value={img.startsWith('data:') ? '(uploaded image)' : img}
              onChange={e => setImg(e.target.value)}
            />
            <label className="file-label" htmlFor="image-file-input">
              📷 Upload image
              <input
                id="image-file-input"
                type="file"
                accept="image/*"
                onChange={e => {
                  const f = e.target.files[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setImg(r.result);
                  r.readAsDataURL(f);
                }}
              />
            </label>
            {img && (
              <button className="btn btn-ghost" onClick={() => setImg('')}>✕ Clear image</button>
            )}
          </div>

          {err && (
            <div className="alert alert-error" role="alert">
              ⚠️ {err}
              <p>Try a product name instead of a URL, or make sure the link is publicly accessible.</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Results ── */}
      {job && (
        <section className="results-section">

          {/* Progress bar */}
          {isRunning && (
            <div className="progress-wrap" role="status" aria-label="Search in progress">
              <div className="progress-track"><div className="progress-fill" /></div>
              <div className="progress-steps">
                <div className="progress-current">{job.progress.at(-1) || job.status + '…'}</div>
                {job.progress.length > 1 && (
                  <div className="progress-log">
                    {job.progress.slice(-4, -1).reverse().map((m, i) => (
                      <span key={i}>{m}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {job.status === 'error' && (
            <div className="alert alert-error" role="alert">
              ❌ Search failed: {job.error}
              <p>Check the URL is public, or try a product name instead.</p>
            </div>
          )}

          {/* Product panel */}
          {job.product && (
            <div className="product-panel" aria-label="Detected product">
              {job.product.image && (
                <img className="product-img" src={job.product.image} alt={job.product.title} />
              )}
              <div className="product-info">
                <div className="product-title">{job.product.title || '(Unnamed product)'}</div>
                {job.product.description && (
                  <p className="product-desc">{job.product.description}</p>
                )}
                <div className="attrs">
                  {job.product.attrs?.type     && <span className="attr-chip">📦 {job.product.attrs.type}</span>}
                  {(job.product.attrs?.colors || []).map(c => <span key={c} className="attr-chip">🎨 {c}</span>)}
                  {job.product.attrs?.graphics && <span className="attr-chip">🖼 {job.product.attrs.graphics}</span>}
                  {job.product.attrs?.material && <span className="attr-chip">🧵 {job.product.attrs.material}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Tabs + controls */}
          <div className="controls-bar">
            <div className="tabs" role="tablist">
              {[
                { key: 'instagram', label: '📸 Instagram Reels' },
                { key: 'meta',      label: '📘 Meta Ads'        },
              ].map(({ key, label }) => {
                const srcRes  = job.results?.[key];
                const good    = srcRes?.good ?? 0;
                const loading = isRunning && !srcRes;
                return (
                  <button
                    key={key}
                    id={`tab-${key}`}
                    role="tab"
                    aria-selected={tab === key}
                    className={`tab-btn ${tab === key ? 'active' : ''}`}
                    onClick={() => setTab(key)}
                  >
                    {label}
                    <span className={`count-badge ${loading ? '' : good >= 20 ? 'good' : 'warn'}`}>
                      {loading ? '…' : `${good}/20`}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="controls-right">
              <select
                id="sort-select"
                className="select"
                value={sort}
                onChange={e => setSort(e.target.value)}
                aria-label="Sort results"
              >
                <option value="score">Best match first</option>
                <option value="new">Newest first</option>
              </select>

              <label className="toggle-label">
                <input
                  id="toggle-low"
                  type="checkbox"
                  checked={showLow}
                  onChange={e => setShowLow(e.target.checked)}
                />
                Show low matches
              </label>

              <label className="toggle-label">
                <input
                  id="toggle-seen"
                  type="checkbox"
                  checked={showSeen}
                  onChange={e => setShowSeen(e.target.checked)}
                />
                Previously seen
              </label>

              <button
                id="export-btn"
                className="btn btn-secondary"
                onClick={exportCsv}
                disabled={starCount === 0}
                title="Export starred videos to CSV"
              >
                ⬇ Export shortlist ({starCount})
              </button>
            </div>
          </div>

          {/* Shortfall warning */}
          {res?.shortfall && (
            <div className="alert alert-warn" role="alert">
              ⚠️ {res.shortfall}
              <p>Try a broader product name, or add a product image URL for better matching.</p>
            </div>
          )}

          {/* Per-tab empty state */}
          {job.status === 'done' && !items.length && (
            <div className="empty-state" role="status">
              <div className="empty-icon">🔍</div>
              <h4>No videos to show for this tab</h4>
              <p>
                {showLow
                  ? 'No videos were found at all for this source.'
                  : 'All videos scored below the match threshold. Tick "Show low matches" to see them, or try a different search.'}
              </p>
            </div>
          )}

          {/* Video grid */}
          <div className="grid" role="list">
            {items.map(v => {
              const safeId = v.id.replace(/[^a-z0-9]/gi, '_');
              const isPlaying = playing === v.id;
              return (
                <div
                  className="card"
                  key={v.id}
                  id={`card-${safeId}`}
                  role="listitem"
                >
                  {/* Media */}
                  <div className="card-media">
                    {isPlaying && v.videoUrl ? (
                      <video
                        className="card-video"
                        src={v.videoUrl}
                        controls
                        autoPlay
                        onError={() => setPlaying(null)}
                        aria-label={`Video: ${(v.caption || '').slice(0, 60)}`}
                      />
                    ) : (
                      <a href={v.url} target="_blank" rel="noreferrer" tabIndex={-1}>
                        <img
                          className="card-thumb"
                          src={v.thumbnail}
                          loading="lazy"
                          alt={(v.caption || '').slice(0, 80) || 'Video thumbnail'}
                          onError={e => { e.target.style.background = '#22222e'; e.target.style.opacity = '0'; }}
                        />
                      </a>
                    )}

                    {/* Inline play button — only if a direct video URL is available */}
                    {v.videoUrl && (
                      <button
                        id={`play-${safeId}`}
                        className="play-btn"
                        onClick={() => setPlaying(isPlaying ? null : v.id)}
                        aria-label={isPlaying ? 'Close video' : 'Play video inline'}
                        title={isPlaying ? 'Close' : 'Play inline'}
                      >
                        {isPlaying ? '✕' : '▶'}
                      </button>
                    )}
                  </div>

                  {/* Body */}
                  <div className="card-body">
                    <div className="card-meta">
                      <span
                        className={`score-badge ${v.low ? 'score-low' : 'score-high'}`}
                        title={`Match score: ${v.score}/100`}
                      >
                        {v.score}
                      </span>
                      <span className="platform-badge">
                        {v.platform === 'instagram' ? '📸' : '📘'} {v.platform}
                      </span>
                      {v.seenBefore && <span className="seen-badge">seen before</span>}
                      <button
                        id={`star-${safeId}`}
                        className={`star-btn ${stars[v.id] ? 'starred' : ''}`}
                        onClick={() => setStars(s => ({ ...s, [v.id]: s[v.id] ? undefined : v }))}
                        aria-label={stars[v.id] ? 'Remove from shortlist' : 'Add to shortlist'}
                        title={stars[v.id] ? 'Remove from shortlist' : 'Add to shortlist'}
                      >
                        {stars[v.id] ? '★' : '☆'}
                      </button>
                    </div>

                    <p className="card-caption">{(v.caption || '').slice(0, 130)}</p>
                    <p className="card-reason">{v.reason}</p>
                    <a
                      className="card-link"
                      href={v.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open on ${v.platform === 'instagram' ? 'Instagram' : 'Meta Ads Library'}`}
                    >
                      View on {v.platform === 'instagram' ? 'Instagram' : 'Meta Ads Library'} →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── History ── */}
      <section className="history-section" aria-label="Search history">
        <h3>Search History</h3>
        {hist.length === 0 ? (
          <p className="empty-hist">No previous searches yet.</p>
        ) : (
          <ul className="hist-list">
            {hist.map(h => (
              <li key={h.id} className="hist-item">
                <button
                  id={`hist-${h.id}`}
                  className="hist-btn"
                  onClick={() => open(h.id)}
                  title="Reload this search"
                >
                  {h.input.query || h.input.url || '(image upload)'}
                </button>
                <span className="hist-meta">
                  {new Date(h.at).toLocaleString()} ·{' '}
                  <span className={`hist-status ${h.status}`}>{h.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
