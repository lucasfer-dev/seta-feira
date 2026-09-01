(() => {
  // SEXTA is currently a personal assistant: PC, Android and browser must
  // represent the same ongoing conversation, not independent local threads.
  const SHARED_CONVERSATION_ID = 'main';
  const previous = localStorage.getItem('sexta_conversation') || '';
  if (previous !== SHARED_CONVERSATION_ID) {
    if (previous) localStorage.setItem('sexta_previous_conversation', previous);
    localStorage.setItem('sexta_conversation', SHARED_CONVERSATION_ID);
  }
  window.__sextaSharedConversationId = SHARED_CONVERSATION_ID;
})();
