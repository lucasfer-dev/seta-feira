import { isOwner, send } from '../../lib/core.mjs';
import { googleStatus } from '../../lib/google.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  return send(res, 200, await googleStatus());
}
