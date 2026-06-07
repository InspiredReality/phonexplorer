const BASE = import.meta.env.VITE_API_URL ?? '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    const err = new Error(detail);
    err.response = { data: { detail } };
    throw err;
  }
  return { data: await res.json() };
}

const api = {
  get: (path) => request(path),

  post: (path, body, opts = {}) => {
    const isForm = body instanceof FormData;
    return request(path, {
      method: 'POST',
      headers: isForm ? opts.headers : { 'Content-Type': 'application/json', ...opts.headers },
      body: isForm ? body : JSON.stringify(body),
    });
  },

  put: (path, body) =>
    request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  delete: (path) => request(path, { method: 'DELETE' }),
};

export default api;

export function getUploadUrl(path) {
  if (!path) return null;
  return `${BASE}/uploads/${path}`;
}
