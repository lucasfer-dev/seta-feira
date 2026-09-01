import { addEvent, getNotifications, saveNotification } from './core.mjs';
import { gmailUnread, googleStatus } from './google.mjs';
import { classifyPriority } from './priority.mjs';

export async function ingestGmailUnread({ maxResults=12 }={}) {
  if (!googleStatus().connected) return { ok:false, reason:'google_not_connected', added:0 };
  const mails=await gmailUnread(maxResults);
  let added=0;
  for (const mail of mails) {
    const p=classifyPriority({
      source:'gmail', sender:mail.from, title:mail.subject, body:mail.snippet,
      metadata:{ gmailImportant:(mail.labelIds||[]).includes('IMPORTANT'), labels:mail.labelIds||[] }
    });
    const result=await saveNotification({
      source:'gmail', sourceId:mail.id, sender:mail.from, title:mail.subject || 'Novo e-mail', body:mail.snippet,
      priority:p.score, reason:p.reason, metadata:{ threadId:mail.threadId, date:mail.date, level:p.level, labels:mail.labelIds||[] }
    });
    if (result?.created) added++;
  }
  if (added) await addEvent({level:'info',title:`Gmail monitorado`,body:`${added} novo(s) e-mail(s) entrou(aram) na triagem da Sexta.`,metadata:{source:'gmail'}});
  return { ok:true, scanned:mails.length, added };
}

export async function runMonitor() {
  const results={ gmail:null };
  try { results.gmail=await ingestGmailUnread(); } catch (error) { results.gmail={ok:false,error:error.message}; }
  const notifications=await getNotifications(20);
  return { results, notifications };
}
