import { isOwner, parseJson, send } from '../lib/core.mjs';
import { LIVE_TOOL_DECLARATIONS } from '../lib/tool-bus.mjs';

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const LIVE_VOICE = process.env.GEMINI_LIVE_VOICE || 'Sulafat';
const SUPPORTS_25_LIVE_FEATURES = /gemini-2\.5/i.test(LIVE_MODEL);

const NON_BLOCKING_LIVE_TOOLS = new Set([
  'android_open_app',
  'android_open_settings',
  'android_set_volume',
  'android_adjust_volume',
  'android_flashlight',
  'android_media',
  'pc_open_app',
  'pc_open_project',
  'pc_open_url',
  'pc_codex_task'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return send(res, 503, { error: 'gemini_live_not_configured' });

  const body = await parseJson(req).catch(() => ({}));
  const baseInstruction = String(
    body.systemInstruction ||
    'Você é SEXTA-feira, uma assistente pessoal de voz. Fale em português brasileiro de forma natural, curta e conversacional.'
  ).slice(0, 9000);
  const resumptionHandle = String(body.resumptionHandle || '').trim().slice(0, 4096);

  const origin = String(body.origin || '').toLowerCase();
  const deviceRule = origin === 'android'
    ? 'DISPOSITIVO ATUAL: Android. Para ações no aparelho atual, prefira SEMPRE ferramentas android_. Só use pc_ se o usuário disser explicitamente PC, computador, Windows ou notebook. EXCEÇÃO: pc_codex_task e pc_codex_status podem ser usados no Android quando o usuário pedir Codex/programação; eles apenas delegam a tarefa ao agente Windows.'
    : origin === 'desktop'
      ? 'DISPOSITIVO ATUAL: PC/desktop. Para ações no computador atual, prefira ferramentas pc_. Só use android_ se o usuário disser explicitamente celular, Android ou telefone.'
      : 'DISPOSITIVO ATUAL: navegador. Escolha Android ou PC apenas quando o pedido ou o contexto indicar claramente o dispositivo. pc_codex_task pode ser usado para delegar programação ao agente Windows.';

  const liveRule = [
    'CONVERSA LIVE: enquanto a sessão estiver ativa, o usuário não precisa repetir “Sexta-feira” antes de cada fala. Trate a interação como conversa contínua.',
    'RESPOSTA DIRETA: quando o usuário disser “Sexta-feira”, chamar você diretamente ou fizer uma pergunta dirigida a você, responda. Não trate isso como fala ambiente irrelevante. Se ele disser apenas seu nome, uma confirmação curta como “tô aqui” é suficiente.',
    'ESCUTA: respeite pausas e hesitações, mas não fique esperando indefinidamente depois que uma frase claramente terminou. Perguntas completas devem receber resposta imediatamente.',
    'INTERRUPÇÃO: se o usuário falar durante sua resposta, ceda a vez imediatamente e acompanhe a nova fala.',
    'PRESENÇA: comentários, piadas, desabafos e observações podem receber reações naturais. Ignore somente fala ambiente que seja claramente de outra pessoa ou não dirigida a você.',
    'RITMO: prefira respostas curtas e deixe espaço para o usuário entrar. Não termine toda fala com pergunta nem use bordões fixos.',
    'FERRAMENTAS: ações rápidas podem acontecer sem narração e, quando forem não bloqueantes, não precisam parar a conversa.'
  ].join('\n');

  const systemInstruction = `${baseInstruction}\n\n${liveRule}\n\nCAPACIDADES REAIS: as ferramentas disponibilizadas nesta sessão são capacidades reais da SEXTA em Android, Google Workspace, WhatsApp, PC, Codex e memória. Quando uma ferramenta puder cumprir o pedido, use-a em vez de explicar manualmente. Nunca afirme que uma ação foi concluída antes da resposta real da ferramenta.\n\n${deviceRule}\n\nCODEX: pc_codex_task inicia tarefas no agente Windows e pode ser chamado mesmo a partir do Android. Use mode=analyze para diagnóstico e mode=edit somente quando o usuário pedir alteração. Não diga que terminou antes de pc_codex_status confirmar completed.\n\nREGRA DE VOZ: mantenha uma única identidade vocal feminina consistente durante toda a sessão.`.slice(0, 14000);

  const now = Date.now();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

  const realtimeInputConfig = {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
      endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
      prefixPaddingMs: 100,
      silenceDurationMs: 600
    },
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY'
  };

  const functionDeclarations = LIVE_TOOL_DECLARATIONS.map(declaration => (
    SUPPORTS_25_LIVE_FEATURES && NON_BLOCKING_LIVE_TOOLS.has(declaration.name)
      ? { ...declaration, behavior: 'NON_BLOCKING' }
      : declaration
  ));
  const tools = [{ functionDeclarations }];

  const inputAudioTranscription = {
    languageCodes: ['pt-BR'],
    mode: 'SMART',
    customVocabulary: ['Sexta-feira', 'Sexta feira', 'Sexta', 'Lucas', 'Codex', 'Envista']
  };
  const outputAudioTranscription = { languageCodes: ['pt-BR'], mode: 'SMART' };
  const contextWindowCompression = { slidingWindow: {} };
  const sessionResumption = resumptionHandle ? { handle: resumptionHandle } : {};

  // O endpoint de tokens efêmeros atualmente rejeita enableAffectiveDialog e
  // proactivity dentro do BidiGenerateContentSetup travado, embora esses recursos
  // existam no setup da Live API. Mantemos o setup compatível para não derrubar a
  // sessão inteira; eles serão reativados depois via configuração parcial/unlocked.
  const setup = {
    model: `models/${LIVE_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      thinkingConfig: { thinkingBudget: 0 },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: LIVE_VOICE
          }
        }
      }
    },
    systemInstruction: { parts: [{ text: systemInstruction }] },
    realtimeInputConfig,
    tools,
    inputAudioTranscription,
    outputAudioTranscription,
    sessionResumption,
    contextWindowCompression
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
      inputAudioTranscription,
      outputAudioTranscription,
      contextWindowCompression,
      sessionResumption,
      enableAffectiveDialog: false,
      proactivity: null,
      supportsNonBlocking: SUPPORTS_25_LIVE_FEATURES,
      thinkingBudget: 0,
      tools
    });
  } catch (error) {
    console.error('Live token network failure:', error);
    return send(res, 503, { error: 'live_token_network_failed', message: error?.message || 'Gemini Live indisponível.' });
  }
}
