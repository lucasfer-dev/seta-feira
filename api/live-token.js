import { isOwner, parseJson, send } from '../lib/core.mjs';
import { LIVE_TOOL_DECLARATIONS } from '../lib/tool-bus.mjs';

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
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

  const origin = String(body.origin || '').toLowerCase();
  const deviceRule = origin === 'android'
    ? 'DISPOSITIVO ATUAL: Android. Para ações no aparelho atual, prefira SEMPRE ferramentas android_. Só use pc_ se o usuário disser explicitamente PC, computador, Windows ou notebook. EXCEÇÃO: pc_codex_task e pc_codex_status podem ser usados no Android quando o usuário pedir Codex/programação; eles apenas delegam a tarefa ao agente Windows.'
    : origin === 'desktop'
      ? 'DISPOSITIVO ATUAL: PC/desktop. Para ações no computador atual, prefira ferramentas pc_. Só use android_ se o usuário disser explicitamente celular, Android ou telefone.'
      : 'DISPOSITIVO ATUAL: navegador. Escolha Android ou PC apenas quando o pedido ou o contexto indicar claramente o dispositivo. pc_codex_task pode ser usado para delegar programação ao agente Windows.';

  const systemInstruction = `${baseInstruction}\n\nCAPACIDADES REAIS: as ferramentas disponibilizadas nesta sessão são capacidades reais da SEXTA em Android, Google Workspace, WhatsApp, PC, Codex e memória. Quando uma ferramenta puder cumprir o pedido, use-a em vez de explicar ao usuário como fazer manualmente. Nunca afirme que uma ação foi concluída antes da resposta real da ferramenta.\n\n${deviceRule}\n\nAÇÕES RÁPIDAS: para abrir app, mudar volume, lanterna ou mídia, aja direto e evite falar antes da chamada. Se uma ferramenta devolver state=accepted/running/queued, diga apenas que o pedido foi enviado ou está em execução; só diga “pronto” quando houver confirmação completed/done.\n\nAÇÕES MAIS LENTAS: quando o pedido exigir leitura/análise que pode demorar alguns segundos, especialmente analisar e-mails, cruzar agenda ou preparar uma tarefa para o Codex, dê no máximo UMA frase curta antes da ferramenta para não parecer que travou. Pode usar naturalmente “Calma, chefe, tô pensando.”. Não repita essa frase em tarefas rápidas nem em toda resposta. Depois que a ferramenta voltar, continue a resposta normalmente.\n\nCODEX: quando o usuário pedir para o Codex analisar, revisar, corrigir ou trabalhar em um projeto configurado no agente Windows, use pc_codex_task. Use mode=analyze quando ele só pedir análise/diagnóstico; use mode=edit somente quando ele pedir explicitamente para corrigir, alterar, implementar ou editar. A ferramenta apenas inicia a tarefa e retorna commandId; não diga que o Codex terminou enquanto o status não estiver completed. Para consultar depois, use pc_codex_status com o commandId disponível no contexto. Não tente instalar Codex, fazer login ou usar OPENAI_API_KEY por conta própria.\n\nGMAIL: para LER e-mails use google_unread_email e leia de forma natural remetente, assunto e trecho disponível. Se o usuário pedir análise/priorização dos e-mails, avise curto que está pensando, chame a ferramenta e só então faça a análise com o resultado real. Para ABRIR o Gmail no Android use android_open_app com app=gmail. Para ABRIR o Gmail no PC use pc_open_url com https://mail.google.com/.\n\nINTERRUPÇÃO DE VOZ: “Sexta-feira”, “minha vez” e “calma” são palavras de interrupção intencional. Quando o cliente indicar uma interrupção, pare a ideia anterior e escute a continuação do usuário.\n\nCONVERSA: evite formato rígido de pergunta e resposta; mantenha uma troca de ideia contínua.\n\nREGRA DE VOZ: mantenha uma única identidade vocal feminina consistente durante toda a sessão. Não altere deliberadamente timbre, personagem, gênero percebido ou identidade da voz entre turnos.`.slice(0, 14000);

  const now = Date.now();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

  // A SEXTA já faz VAD no cliente. Desligar o VAD automático do Gemini evita
  // uma segunda espera de silêncio: o cliente envia activityStart/activityEnd
  // exatamente nas fronteiras detectadas localmente.
  const realtimeInputConfig = {
    automaticActivityDetection: {
      disabled: true
    },
    activityHandling: 'NO_INTERRUPTION',
    turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY'
  };

  const tools = [{ functionDeclarations: LIVE_TOOL_DECLARATIONS }];
  const transcription = {
    languageCodes: ['pt-BR'],
    mode: 'SMART',
    customVocabulary: ['Sexta-feira', 'minha vez', 'calma', 'Codex']
  };

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
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    realtimeInputConfig,
    tools,
    inputAudioTranscription: transcription,
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
      inputAudioTranscription: transcription,
      thinkingBudget: 0,
      tools
    });
  } catch (error) {
    console.error('Live token network failure:', error);
    return send(res, 503, { error: 'live_token_network_failed', message: error?.message || 'Gemini Live indisponível.' });
  }
}
