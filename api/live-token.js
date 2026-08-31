import { isOwner, parseJson, send } from '../lib/core.mjs';

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const LIVE_VOICE = process.env.GEMINI_LIVE_VOICE || 'Sulafat';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return send(res, 503, { error: 'gemini_live_not_configured' });

  const body = await parseJson(req).catch(() => ({}));
  const baseInstruction = String(body.systemInstruction || 'Você é SEXTA-feira, uma assistente pessoal de voz. Fale em português brasileiro de forma natural, curta e conversacional.').slice(0, 10800);
  const systemInstruction = `${baseInstruction}\n\nAs ações externas são executadas pelo orquestrador da SEXTA em paralelo à conversa. Nunca afirme que uma ação foi concluída se o aplicativo não tiver confirmado isso. Quando o usuário pedir algo relacionado a Gmail, Google, WhatsApp, apps, Android, PC, agenda, contatos, arquivos ou outras integrações, NÃO diga que você não tem acesso, que não possui ação do sistema ou que o usuário precisa abrir o aplicativo. O roteador da SEXTA decide e executa essas capacidades fora do Gemini. Se o pedido parecer uma ação ou consulta de integração, seja breve e neutra enquanto o aplicativo resolve; não invente limitações nem resultados. Restrições de segurança reais do modelo continuam valendo normalmente.\n\nREGRA DE VOZ: mantenha uma única identidade vocal feminina consistente durante toda a sessão. Não altere deliberadamente timbre, personagem, gênero percebido ou identidade da voz entre turnos.`.slice(0, 12000);

  const now = Date.now();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

  const realtimeInputConfig = {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
      endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
      prefixPaddingMs: 120,
      silenceDurationMs: 600
    },
    activityHandling: 'NO_INTERRUPTION',
    turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY'
  };

  const setup = {
    model: `models/${LIVE_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: LIVE_VOICE
          }
        }
      }
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    realtimeInputConfig,
    inputAudioTranscription: { languageCodes: ['pt-BR'], mode: 'SMART' },
    outputAudioTranscription: { languageCodes: ['pt-BR'], mode: 'SMART' },
    contextWindowCompression: { slidingWindow: {} }
  };

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
        bidiGenerateContentSetup: setup
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.name) {
      const message = data?.error?.message || `gemini_live_token_http_${response.status}`;
      console.error('Live token failed:', message);
      return send(res, response.status || 502, { error: 'live_token_failed', message });
    }

    return send(res, 200, {
      token: data.name,
      model: LIVE_MODEL,
      voice: LIVE_VOICE,
      expireTime,
      newSessionExpireTime,
      setupLocked: true,
      actionRouter: 'sexta-tool-bus',
      activityHandling: realtimeInputConfig.activityHandling
    });
  } catch (error) {
    console.error('Live token network failure:', error);
    return send(res, 503, { error: 'live_token_network_failed', message: error?.message || 'Gemini Live indisponível.' });
  }
}
