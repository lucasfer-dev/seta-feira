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

async function generatePcm(text) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw Object.assign(new Error('gemini_tts_not_configured'), { status: 503 });

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(text) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: TTS_VOICE }
          }
        }
      }
    })
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req);
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 3500);
  if (!text) return send(res, 400, { error: 'text_required' });

  try {
    let pcm;
    try {
      pcm = await generatePcm(text);
    } catch (firstError) {
      // Gemini 3.1 TTS can very rarely return no audio; retry once before falling back client-side.
      if (![429, 500, 502, 503].includes(Number(firstError?.status))) throw firstError;
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
    console.error('TTS failed:', error);
    return send(res, Number(error?.status) || 500, {
      error: 'tts_failed',
      message: error?.message || 'Não consegui gerar a voz agora.'
    });
  }
}
