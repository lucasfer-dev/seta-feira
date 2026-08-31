import { getDevices, getEvents, getMemories, getMessages, getNotifications, getSettings, isOwner, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://localhost');
  const conversationId = url.searchParams.get('conversationId') || 'main';
  try {
    const [messages, memories, devices, events, notifications, settings] = await Promise.all([
      getMessages(conversationId, 50), getMemories(20), getDevices(), getEvents(12), getNotifications(40), getSettings()
    ]);
    send(res, 200, { messages, memories, devices, events, notifications, settings });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: 'sync_failed', message: error.message });
  }
}
