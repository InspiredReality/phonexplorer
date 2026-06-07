const BASE = process.env.REACT_APP_API_URL ?? '';

export async function fetchObjects() {
  const res = await fetch(`${BASE}/api/objects`);
  if (!res.ok) throw new Error('Failed to fetch objects');
  return res.json();
}

export async function createObject(data) {
  const res = await fetch(`${BASE}/api/objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create object');
  return res.json();
}

export async function addRelationship(fromId, toId) {
  const res = await fetch(`${BASE}/api/objects/${fromId}/relationships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ related_id: toId }),
  });
  if (!res.ok) throw new Error('Failed to add relationship');
  return res.json();
}

export async function deleteObject(id) {
  const res = await fetch(`${BASE}/api/objects/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete object');
}
