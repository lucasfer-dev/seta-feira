import { isOwner, parseJson, send } from '../lib/core.mjs';
import { LIVE_TOOL_DECLARATIONS } from '../lib/tool-bus.mjs';

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const LIVE_VOICE = process.env.GEMINI_LIVE_VOICE || 'Sulafat';

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
  ).slice(0, 9400);

  const origin = String(body.origin || '').toLowerCase();
  const deviceRule = origin === 'android'
    ? 'DISPOSITIVO ATUAL: Android. Para ações no aparelho atual, prefira SEMPRE ferramentas android_. Só use pc_ se o usuário disser explicitamente PC, computador, Windows ou notebook. EXCEÇÃO: pc_codex_task e pc_codex_status podem ser usados no Android quando o usuário pedir Codex/programação; eles apenas delegam a tarefa ao agente Windows.'
    : origin === 'desktop'
      ? 'DISPOSITIVO ATUAL: PC/desktop. Para ações no computador atual, prefira ferramentas pc_. Só use android_ se o usuário disser explicitamente celular, Android ou telefone.'
      : 'DISPOSITIVO ATUAL: navegador. Escolha Android ou PC apenas quando o pedido ou o contexto indicar claramente o dispositivo. pc_codex_task pode ser usado para delegar programação ao agente Windows.';

  const conversationRule = [
    'MODO CONVERSA CONTÍNUA: isto é uma conversa de voz ao vivo, não um formulário de pergunta e resposta. Acompanhe assunto, tom, piadas, correções, hesitações e mudanças de ideia como numa conversa normal.',
    'INTERRUPÇÃO NATURAL: durante uma sessão Live ativa, NÃO exija “Sexta-feira”, “minha vez” ou “calma” para ceder a palavra. Qualquer fala clara do usuário enquanto você estiver falando significa que ele quer entrar na conversa. Pare a ideia atual e escute. Esta regra substitui qualquer regra anterior que exija palavra de ativação para interromper.',
    'FRASES INCOMPLETAS: se a fala parecer claramente um fragmento, uma hesitação ou continuação — por exemplo “mas tu viu que é...”, “eu... eu...” — não invente uma resposta completa nem mude de assunto. Dê espaço. Se for útil, use no máximo uma reação curta e natural; caso contrário aguarde a continuação.',
    'RITMO: conversa casual pede respostas curtas, normalmente uma ou duas frases. Só aprofunde quando o usuário pedir ou quando o assunto realmente exigir. Evite introduções genéricas como “claro”, “com certeza”, “como posso ajudar” e evite repetir “chefe” em toda fala.',
    'CONTEXTO: referências curtas como “isso”, “ele”, “mas tu viu”, “e aquilo?” devem usar o assunto imediatamente anterior. Não obrigue o usuário a repetir contexto que já está na sessão.',
    'REPARO DE FALA: transcrição de voz pode vir quebrada, repetida ou estranha. Priorize a intenção e o contexto. Se realmente não der para entender, faça uma pergunta curta e específica, sem transformar a conversa numa entrevista.',
    'AÇÕES + CONVERSA: quando o usuário misturar uma ação com conversa, execute a ação e continue a conversa naturalmente. Não transforme “abre o Spotify... e qual Pokémon tu acha mais bonito?” em duas interações separadas.',
    'FERRAMENTAS RÁPIDAS: ações marcadas como não bloqueantes podem rodar enquanto a conversa continua. Não narre “executando ferramenta”. Só mencione o resultado quando ele importar e nunca diga que terminou antes da confirmação real.',
    'PERSONALIDADE: seja espontânea e consistente, mas não siga bordões fixos. Humor e informalidade devem surgir do contexto, não de um script.'
  ].join('\n');

  const systemInstruction = `${baseInstruction}\n\n${conversationRule}\n\nCAPACIDADES REAIS: as ferramentas disponibilizadas nesta sessão são capacidades reais da SEXTA em Android, Google Workspace, WhatsApp, PC, Codex e memória. Quando uma ferramenta puder cumprir o pedido, use-a em vez de explicar ao usuário como fazer manualmente. Nunca afirme que uma ação foi concluída antes da resposta real da ferramenta.\n\n${deviceRule}\n\nAÇÕES RÁPIDAS: para abrir app, mudar volume, lanterna ou mídia, aja direto e evite falar antes da chamada. Se a ação puder continuar em segundo plano, mantenha a conversa em vez de esperar em silêncio. Se uma ferramenta devolver state=accepted/running/queued, diga apenas que foi enviada ou está em execução quando isso for relevante; só diga “pronto” quando houver confirmação completed/done.\n\nAÇÕES MAIS LENTAS: quando o pedido exigir leitura/análise cujo resultado seja necessário para responder, especialmente e-mails ou agenda, dê no máximo UMA confirmação curta antes da ferramenta se houver espera perceptível. Não repita a mesma frase em todas as tarefas.\n\nCODEX: quando o usuário pedir para o Codex analisar, revisar, corrigir ou trabalhar em um projeto configurado no agente Windows, use pc_codex_task. Use mode=analyze quando ele só pedir análise/diagnóstico; use mode=edit somente quando ele pedir explicitamente para corrigir, alterar, implementar ou editar. A ferramenta apenas inicia a tarefa e retorna commandId; não diga que o Codex terminou enquanto o status não estiver completed. Para consultar depois, use pc_codex_status com o commandId disponível no contexto. Não tente instalar Codex, fazer login ou usar OPENAI_API_KEY por conta própria.\n\nGMAIL: para LER e-mails use google_unread_email e leia de forma natural remetente, assunto e trecho disponível. Para ABRIR o Gmail no Android use android_open_app com app=gmail. Para ABRIR o Gmail no PC use pc_open_url com https://mail.google.com/.\n\nREGRA DE VOZ: mantenha uma única identidade vocal feminina consistente durante toda a sessão. Não altere deliberadamente timbre, personagem, gênero percebido ou identidade da voz entre turnos.`.slice(0, 14000);

  const now = Date.now();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

  // VAD híbrido: o servidor detecta rapidamente o começo da fala e funciona
  // como fallback de fim de fala. O cliente ainda pode usar audioStreamEnd para
  // finalizar cedo sem a espera extra do servidor.
  const realtimeInputConfig = {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
      endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
      prefixPaddingMs: 100,
      silenceDurationMs: 750
    },
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY'
  };

  const functionDeclarations = LIVE_TOOL_DECLARATIONS.map(declaration => (
    NON_BLOCKING_LIVE_TOOLS.has(declaration.name)
      ? { ...declaration, behavior: 'NON_BLOCKING' }
      : declaration
  ));
  const tools = [{ functionDeclarations }];
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
