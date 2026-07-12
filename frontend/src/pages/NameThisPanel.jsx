import { useState, useEffect, useCallback } from 'react';

const BASE = import.meta.env.VITE_API_URL ?? '';
const PAGE_SIZE = 50;
const TOKEN_KEY = 'stickerAdminToken';

async function apiFetchStickers({ untaggedOnly = false, limit = PAGE_SIZE, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset });
  if (untaggedOnly) params.set('untagged', 'true');
  const res = await fetch(`${BASE}/api/stickers?${params}`);
  if (!res.ok) throw new Error('Failed to fetch stickers');
  return res.json();
}

async function apiAddTag(imageId, tag) {
  const res = await fetch(`${BASE}/api/stickers/${imageId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: [tag] }),
  });
  if (!res.ok) throw new Error('Failed to add tag');
  return res.json();
}

async function apiRename(imageId, name, token) {
  const res = await fetch(`${BASE}/api/admin/images/${imageId}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error('Failed to rename');
  return res.json();
}

function StickerCard({ sticker, isAdmin, onAddTag, onRename }) {
  const [nameDraft, setNameDraft] = useState(sticker.name);
  const [tagDraft, setTagDraft] = useState('');
  const [tags, setTags] = useState(sticker.tags);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [addingTag, setAddingTag] = useState(false);

  const submitTag = async () => {
    const tag = tagDraft.trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;
    setAddingTag(true);
    try {
      await onAddTag(sticker.id, tag);
      setTags((prev) => [...prev, tag]);
      setTagDraft('');
    } catch {
      // leave input as-is so the user can retry
    } finally {
      setAddingTag(false);
    }
  };

  const submitName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === sticker.name) return;
    setSavingName(true);
    try {
      await onRename(sticker.id, trimmed);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 1500);
    } catch {
      setNameDraft(sticker.name);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="sticker-card">
      <div className="img-wrap">
        <img src={sticker.url} alt={sticker.name} loading="lazy" />
      </div>

      {isAdmin ? (
        <div className="name-edit-row">
          <input
            className="name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitName()}
            disabled={savingName}
          />
          <button className="name-save-btn" onClick={submitName} disabled={savingName || nameDraft.trim() === sticker.name}>
            {savingName ? '…' : nameSaved ? '✓' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="sticker-name">{sticker.name}</div>
      )}

      <div className="sticker-tags">
        {tags.map((t) => <span key={t} className="chip">{t}</span>)}
        {tags.length === 0 && <span className="no-tags">untagged</span>}
      </div>

      <div className="add-tag-row">
        <input
          className="add-tag-input"
          placeholder="Add tag…"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitTag()}
          disabled={addingTag}
        />
        <button className="add-tag-btn" onClick={submitTag} disabled={addingTag || !tagDraft.trim()}>+</button>
      </div>
    </div>
  );
}

export default function NameThisPanel() {
  const [stickers, setStickers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');

  const load = useCallback(async (reset = true) => {
    setLoading(true);
    setError(null);
    const currentOffset = reset ? 0 : offset;
    try {
      const data = await apiFetchStickers({ untaggedOnly, limit: PAGE_SIZE, offset: currentOffset });
      if (reset) { setStickers(data.results); setOffset(PAGE_SIZE); }
      else { setStickers((prev) => [...prev, ...data.results]); setOffset((o) => o + PAGE_SIZE); }
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [untaggedOnly, offset]);

  useEffect(() => { load(true); }, [untaggedOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddTag = (imageId, tag) => apiAddTag(imageId, tag);

  const handleRename = async (imageId, name) => {
    try {
      await apiRename(imageId, name, adminToken);
    } catch (err) {
      if (err.message === 'unauthorized') {
        alert('That admin token was rejected. Please log in again.');
        localStorage.removeItem(TOKEN_KEY);
        setAdminToken('');
      }
      throw err;
    }
  };

  const handleLogin = () => {
    const token = window.prompt('Enter admin token:');
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      setAdminToken(token);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setAdminToken('');
  };

  return (
    <div className="name-this-panel">
      <div className="name-this-toolbar">
        <label className="untagged-toggle">
          <input
            type="checkbox"
            checked={untaggedOnly}
            onChange={(e) => setUntaggedOnly(e.target.checked)}
          />
          Show untagged only
        </label>

        {adminToken ? (
          <button className="admin-toggle-btn admin-on" onClick={handleLogout}>Admin mode — Log out</button>
        ) : (
          <button className="admin-toggle-btn" onClick={handleLogin}>Log in as admin to rename</button>
        )}
      </div>

      {error && <p className="stickers-error">{error}</p>}

      {loading && stickers.length === 0 && <p className="stickers-empty">Loading…</p>}
      {!loading && stickers.length === 0 && !error && <p className="stickers-empty">No stickers match.</p>}

      {stickers.length > 0 && (
        <>
          <p className="result-count">{total} sticker{total !== 1 ? 's' : ''}</p>
          <div className="name-this-grid">
            {stickers.map((s) => (
              <StickerCard
                key={s.id}
                sticker={s}
                isAdmin={!!adminToken}
                onAddTag={handleAddTag}
                onRename={handleRename}
              />
            ))}
          </div>
          {stickers.length < total && (
            <button className="load-more-btn" onClick={() => load(false)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
