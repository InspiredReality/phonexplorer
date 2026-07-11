import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import NameThisPanel from './NameThisPanel';
import './StickersPage.css';

const BASE = import.meta.env.VITE_API_URL ?? '';
const PAGE_SIZE = 50;

async function apiFetchTags() {
  const res = await fetch(`${BASE}/api/stickers/tags`);
  if (!res.ok) throw new Error('Failed to fetch tags');
  return res.json();
}

async function apiFetchStickers({ tags = [], mode = 'or', limit = PAGE_SIZE, offset = 0 } = {}) {
  const params = new URLSearchParams({ mode, limit, offset });
  if (tags.length) params.set('tags', tags.join(','));
  const res = await fetch(`${BASE}/api/stickers?${params}`);
  if (!res.ok) throw new Error('Failed to fetch stickers');
  return res.json();
}

async function apiFetchRandom({ tags = [], mode = 'or' } = {}) {
  const params = new URLSearchParams({ mode });
  if (tags.length) params.set('tags', tags.join(','));
  const res = await fetch(`${BASE}/api/stickers/random?${params}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch random sticker');
  return res.json();
}

export default function Stickers() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('finder');

  const [tags, setTags] = useState([]);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [mode, setMode] = useState('or');
  const [view, setView] = useState('random');

  const [randomSticker, setRandomSticker] = useState(undefined);
  const [randomLoading, setRandomLoading] = useState(false);

  const [stickers, setStickers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [gridLoading, setGridLoading] = useState(false);

  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetchTags().then(setTags).catch(() => {});
  }, []);

  const toggleTag = (name) =>
    setSelectedTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );

  const filteredTags = tags.filter((t) => t.name.includes(tagSearch.trim().toLowerCase()));

  const handleTagSearchKeyDown = (e) => {
    if (e.key === 'Enter' && filteredTags.length === 1) {
      toggleTag(filteredTags[0].name);
      setTagSearch('');
    }
  };

  const handleRandom = useCallback(async () => {
    setRandomLoading(true);
    setError(null);
    try {
      setRandomSticker(await apiFetchRandom({ tags: selectedTags, mode }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRandomLoading(false);
    }
  }, [selectedTags, mode]);

  const loadGrid = useCallback(async (reset = true) => {
    setGridLoading(true);
    setError(null);
    const currentOffset = reset ? 0 : offset;
    try {
      const data = await apiFetchStickers({ tags: selectedTags, mode, limit: PAGE_SIZE, offset: currentOffset });
      if (reset) { setStickers(data.results); setOffset(PAGE_SIZE); }
      else { setStickers((prev) => [...prev, ...data.results]); setOffset((o) => o + PAGE_SIZE); }
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setGridLoading(false);
    }
  }, [selectedTags, mode, offset]);

  const handleShowGrid = () => { setView('grid'); loadGrid(true); };

  return (
    <div className="stickers-page">
      <header className="stickers-header">
        <button className="back-btn" onClick={() => navigate('/')}>← back</button>
        <h1 className="stickers-title">Sticker Finder</h1>
      </header>

      <div className="tab-row">
        <button className={`tab-btn ${activeTab === 'finder' ? 'active' : ''}`} onClick={() => setActiveTab('finder')}>Sticker Finder</button>
        <button className={`tab-btn ${activeTab === 'name-this' ? 'active' : ''}`} onClick={() => setActiveTab('name-this')}>Name This</button>
      </div>

      {activeTab === 'name-this' ? (
        <NameThisPanel />
      ) : (
        <>
      <section className="stickers-controls">
        <div className="mode-row">
          <label><input type="radio" value="or" checked={mode === 'or'} onChange={() => setMode('or')} /> Any tag</label>
          <label><input type="radio" value="and" checked={mode === 'and'} onChange={() => setMode('and')} /> All tags</label>
        </div>

        {selectedTags.length > 0 && (
          <div className="selected-tags-row">
            {selectedTags.map((name) => (
              <button key={name} className="selected-tag-chip" onClick={() => toggleTag(name)}>
                {name} <span className="selected-tag-remove">×</span>
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          className="tag-search-input"
          placeholder="Search tags…"
          value={tagSearch}
          onChange={(e) => setTagSearch(e.target.value)}
          onKeyDown={handleTagSearchKeyDown}
        />

        <div className="tag-cloud">
          {filteredTags.map((t) => (
            <button
              key={t.name}
              className={`tag-pill ${selectedTags.includes(t.name) ? 'active' : ''}`}
              onClick={() => toggleTag(t.name)}
            >
              {t.name} <span className="tag-pill-count">{t.count}</span>
            </button>
          ))}
          {tagSearch && filteredTags.length === 0 && (
            <span className="tag-search-empty">No tags match "{tagSearch}"</span>
          )}
        </div>

        <div className="action-row">
          <button className={`view-btn ${view === 'random' ? 'active' : ''}`} onClick={() => setView('random')}>Random</button>
          <button className={`view-btn ${view === 'grid' ? 'active' : ''}`} onClick={handleShowGrid}>All matches</button>
          {selectedTags.length > 0 && (
            <button className="clear-btn" onClick={() => setSelectedTags([])}>Clear filters</button>
          )}
        </div>
      </section>

      {error && <p className="stickers-error">{error}</p>}

      <main className="stickers-main">
        {view === 'random' ? (
          <div className="random-section">
            <button className="random-btn" onClick={handleRandom} disabled={randomLoading}>
              {randomLoading ? 'Loading…' : 'Show random sticker'}
            </button>
            {randomSticker && (
              <div className="random-result">
                <img src={randomSticker.url} alt={randomSticker.filename} className="random-img" />
                <div className="sticker-tags">
                  {randomSticker.tags.map((t) => <span key={t} className="chip">{t}</span>)}
                </div>
              </div>
            )}
            {randomSticker === null && !randomLoading && (
              <p className="stickers-empty">No sticker found for the selected filters.</p>
            )}
          </div>
        ) : (
          <div className="grid-section">
            {gridLoading && stickers.length === 0 && <p className="stickers-empty">Loading…</p>}
            {!gridLoading && stickers.length === 0 && <p className="stickers-empty">No stickers match.</p>}
            {stickers.length > 0 && (
              <>
                <p className="result-count">{total} result{total !== 1 ? 's' : ''}</p>
                <div className="sticker-grid">
                  {stickers.map((s) => (
                    <div key={s.id} className="sticker-card">
                      <div className="img-wrap">
                        <img src={s.url} alt={s.filename} loading="lazy" />
                      </div>
                      <div className="sticker-tags">
                        {s.tags.map((t) => <span key={t} className="chip">{t}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
                {stickers.length < total && (
                  <button className="load-more-btn" onClick={() => loadGrid(false)} disabled={gridLoading}>
                    {gridLoading ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </main>
        </>
      )}
    </div>
  );
}
