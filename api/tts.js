import { isOwner, parseJson, send } from '../lib/core.mjs';

const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Sulafat';
const SAMPLE_RATE = 24000;

function pcmToWav(pcm, sampleRate = SAMPLE_RATE, channels = 1, bitsPerSample = 16) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function buildPrompt(text) {
  return [
    'Synthesize speech only. Do not read the directions aloud.',
    'Audio profile: voz feminina brasileira, natural, calorosa, confiante e elegante; assistente pessoal conversando de perto, nunca locutora.',
    'Director notes: português do Brasil; ritmo conversacional; pausas naturais; entonação humana e sutil; dicção clara sem exagero; preserve exatamente o sentido do texto.',
    'TRANSCRIPT TO SPEAK:',
    text
  ].join('\n');
}

function geminiRequestBody(text) {
  return {
    contents: [{ parts: [{ text: buildPrompt(text) }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: TTS_VOICE }
        }
      }
    }
  };
}

function geminiKey() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw Object.assign(new Error('gemini_tts_not_configured'), { status: 503 });
  return key;
}

async function generatePcm(text) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': geminiKey()
    },
    body: JSON.stringify(geminiRequestBody(text))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `gemini_tts_http_${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }

  const part = data?.candidates?.[0]?.content?.parts?.find(item => item?.inlineData?.data);
  const encoded = part?.inlineData?.data;
  if (!encoded) throw Object.assign(new Error('gemini_tts_no_audio'), { status: 502 });
  return Buffer.from(encoded, 'base64');
}

function extractSseData(eventText) {
  return eventText
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean)
    .join('\n');
}

async function streamPcm(text, req, res) {
  const upstreamController = new AbortController();
  const abort = () => upstreamController.abort();
  req.once?.('aborted', abort);
  res.once?.('close', abort);

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey()
      },
      body: JSON.stringify(geminiRequestBody(text)),
      signal: upstreamController.signal
    }
  );

  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => '');
    let message = `gemini_tts_http_${upstream.status}`;
    try { message = JSON.parse(raw)?.error?.message || message; } catch {}
    throw Object.assign(new Error(message), { status: upstream.status });
  }
  if (!upstream.body) throw Object.assign(new Error('gemini_tts_stream_unavailable'), { status: 502 });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-SEXTA-TTS-Stream', 'pcm-s16le');
  res.setHeader('X-SEXTA-TTS-Sample-Rate', String(SAMPLE_RATE));
  res.setHeader('X-SEXTA-TTS-Channels', '1');
  res.setHeader('X-SEXTA-TTS-Model', TTS_MODEL);
  res.setHeader('X-SEXTA-TTS-Voice', TTS_VOICE);
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let wroteAudio = false;

  const processEvent = eventText => {
    const payload = extractSseData(eventText);
    if (!payload || payload === '[DONE]') return;
    let data;
    try { data = JSON.parse(payload); } catch { return; }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      const encoded = part?.inlineData?.data;
      if (!encoded) continue;
      const pcm = Buffer.from(encoded, 'base64');
      if (!pcm.length) continue;
      wroteAudio = true;
      res.write(pcm);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
        const separator = pending.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || '\n\n';
        const eventText = pending.slice(0, boundary);
        pending = pending.slice(boundary + separator.length);
        processEvent(eventText);
      }
    }

    pending += decoder.decode();
    if (pending.trim()) processEvent(pending);
    if (!wroteAudio) console.warn('Gemini TTS stream ended without audio');
    res.end();
  } finally {
    req.off?.('aborted', abort);
    res.off?.('close', abort);
    try { reader.releaseLock(); } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req);
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 3500);
  if (!text) return send(res, 400, { error: 'text_required' });

  try {
    if (body.stream === true) return await streamPcm(text, req, res);

    let pcm;
    try {
      pcm = await generatePcm(text);
    } catch (firstError) {
      // Never retry a 429 immediately: that only burns another request in the same quota window.
      if (![500, 502, 503].includes(Number(firstError?.status))) throw firstError;
      pcm = await generatePcm(text);
    }

    const wav = pcmToWav(pcm);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wav.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-SEXTA-TTS-Model', TTS_MODEL);
    res.setHeader('X-SEXTA-TTS-Voice', TTS_VOICE);
    return res.end(wav);
  } catch (error) {
    if (error?.name === 'AbortError' || res.destroyed) return;
    console.error('TTS failed:', error);
    if (res.headersSent) {
      try { return res.end(); } catch { return; }
    }
    return send(res, Number(error?.status) || 500, {
      error: 'tts_failed',
      message: error?.message || 'Não consegui gerar a voz agora.'
    });
  }
}
