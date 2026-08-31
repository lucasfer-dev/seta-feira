import { isOwner, parseJson, send } from '../lib/core.mjs';
import { LIVE_TOOL_DECLARATIONS } from '../lib/tool-bus.mjs';

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const LIVE_VOICE = process.env.GEMINI_LIVE_VOICE || 'Sulafat';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return send(res, 503, { error: 'gemini_live_not_configured' });

  const body = await parseJson(req).catch(() => ({}));
  const baseInstruction = String(
    body.systemInstruction ||
    'Você é SEXTA-feira, uma assistente pessoal de voz. Fale em português brasileiro de forma natural, curta e conversacional.'
  ).slice(0, 10600);

  const systemInstruction = `${baseInstruction}\n\nCAPACIDADES REAIS: as ferramentas disponibilizadas nesta sessão são capacidades reais da SEXTA em Android, Google Workspace, WhatsApp, PC e memória. Quando uma ferramenta puder cumprir o pedido, use-a em vez de explicar ao usuário como fazer manualmente. Nunca afirme que uma ação foi concluída antes da resposta real da ferramenta. Para tarefas que possam demorar perceptivelmente, você pode dar uma confirmação verbal curtíssima antes da chamada, como “Certo, procurando.” ou “Tá bom, vou ver.”, e então agir. Para ações instantâneas, priorize agir rápido. Se uma ferramenta falhar, explique a falha de forma breve e continue disponível.\n\nCONVERSA: o usuário pode interromper você a qualquer momento. Se isso acontecer, pare a resposta atual e acompanhe a nova intenção sem reclamar da interrupção. Evite formato rígido de pergunta e resposta; mantenha uma troca de ideia contínua.\n\nREGRA DE VOZ: mantenha uma única identidade vocal feminina consistente durante toda a sessão. Não altere deliberadamente timbre, personagem, gênero percebido ou identidade da voz entre turnos.`.slice(0, 12000);

  const now = Date.now();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

  // Tuned for conversation rather than push-to-talk: keep start detection
  // conservative enough to avoid random room noise, but finish turns faster.
  const realtimeInputConfig = {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
      endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
      prefixPaddingMs: 60,
      silenceDurationMs: 420
    },
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY'
  };

  const tools = [{ functionDeclarations: LIVE_TOOL_DECLARATIONS }];

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
    tools,
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
      actionRouter: 'gemini-live-tool-calling',
      activityHandling: realtimeInputConfig.activityHandling,
      realtimeInputConfig,
      tools
    });
  } catch (error) {
    console.error('Live token network failure:', error);
    return send(res, 503, { error: 'live_token_network_failed', message: error?.message || 'Gemini Live indisponível.' });
  }
}
