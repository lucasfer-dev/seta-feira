const OWNER = 'owner';

function config() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '',
    apiKey: process.env.SEXTA_DATA_API_KEY || ''
  };
}

export function missionPersistenceEnabled() {
  const c = config();
  return Boolean(c.url && c.key && c.apiKey);
}

async function request(path, { method = 'GET', query = {}, body, prefer } = {}) {
  const c = config();
  if (!missionPersistenceEnabled()) return null;

  const url = new URL(`${c.url}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const headers = {
    apikey: c.key,
    Authorization: `Bearer ${c.key}`,
    'x-sexta-api-key': c.apiKey,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MISSION_STORE_${response.status}: ${text.slice(0, 500)}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function toRow(mission) {
  return {
    id: mission.id,
    owner_id: OWNER,
    goal: mission.goal,
    status: mission.status,
    source_device_id: mission.sourceDeviceId || null,
    assigned_device_id: mission.assignedDeviceId || null,
    required_capability: mission.requiredCapability || null,
    context: mission.context || {},
    steps: mission.steps || [],
    result: mission.result || null,
    error: mission.error || null,
    created_at: mission.createdAt,
    updated_at: mission.updatedAt
  };
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    goal: row.goal,
    status: row.status,
    sourceDeviceId: row.source_device_id || null,
    assignedDeviceId: row.assigned_device_id || null,
    requiredCapability: row.required_capability || null,
    context: row.context || {},
    steps: row.steps || [],
    result: row.result || null,
    error: row.error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function persistMission(mission) {
  if (!missionPersistenceEnabled()) return mission;
  const rows = await request('sexta_missions', {
    method: 'POST',
    query: { on_conflict: 'id' },
    body: toRow(mission),
    prefer: 'resolution=merge-duplicates,return=representation'
  });
  return fromRow(rows?.[0]) || mission;
}

export async function loadMission(id) {
  if (!missionPersistenceEnabled()) return null;
  const rows = await request('sexta_missions', {
    query: {
      select: 'id,goal,status,source_device_id,assigned_device_id,required_capability,context,steps,result,error,created_at,updated_at',
      id: `eq.${id}`,
      owner_id: 'eq.owner',
      limit: '1'
    }
  });
  return fromRow(rows?.[0]);
}

export async function loadMissions({ status, limit = 100 } = {}) {
  if (!missionPersistenceEnabled()) return [];
  const query = {
    select: 'id,goal,status,source_device_id,assigned_device_id,required_capability,context,steps,result,error,created_at,updated_at',
    owner_id: 'eq.owner',
    order: 'updated_at.desc',
    limit: String(limit)
  };
  if (status) query.status = `eq.${status}`;
  const rows = await request('sexta_missions', { query });
  return (rows || []).map(fromRow);
}
