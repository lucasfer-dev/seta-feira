import { getDevices, getEvents, getMemories, getMessages, getNotifications, getSettings, isOwner, send } from '../lib/core.mjs';

const SHARED_CONVERSATION_ID = 'main';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    const [messages, memories, devices, events, notifications, settings] = await Promise.all([
      getMessages(SHARED_CONVERSATION_ID, 80), getMemories(40), getDevices(), getEvents(20), getNotifications(40), getSettings()
    ]);
    send(res, 200, { conversationId: SHARED_CONVERSATION_ID, messages, memories, devices, events, notifications, settings });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: 'sync_failed', message: error.message });
  }
}
