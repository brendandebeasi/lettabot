import { createLogger } from '../logger.js';

const log = createLogger('OpenCode');
const OPENCODE_URL = process.env.OPENCODE_URL || 'http://localhost:4096';

export interface OpenCodeResponse {
  text: string;
  sessionId: string;
  toolCalls: number;
}

export async function sendToOpenCode(
  message: string,
  projectDir: string,
  model?: string,
): Promise<OpenCodeResponse> {
  const headers: Record<string, string> = {
    'x-opencode-directory': projectDir,
    'Content-Type': 'application/json',
  };

  const sessionRes = await fetch(`${OPENCODE_URL}/session`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const session = await sessionRes.json() as { id: string };
  const sessionId = session.id;
  log.info(`OpenCode session created: ${sessionId} (dir=${projectDir})`);

  const body: Record<string, unknown> = {
    parts: [{ type: 'text', text: message }],
  };
  if (model) {
    const [provider, modelId] = model.split('/', 2);
    body.model = { providerID: provider, modelID: modelId };
  } else {
    body.model = { providerID: 'google', modelID: 'gemini-2.5-flash' };
  }

  await fetch(`${OPENCODE_URL}/session/${sessionId}/prompt_async`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let text = '';
  let toolCalls = 0;
  const maxWait = 120_000;
  const pollInterval = 2_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, pollInterval));

    const msgRes = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`, { headers });
    const messages = await msgRes.json() as Array<{
      info?: { role?: string };
      parts?: Array<{ type?: string; text?: string; state?: { status?: string } }>;
    }>;

    let hasAssistant = false;
    for (const msg of messages) {
      if (msg.info?.role === 'assistant') {
        hasAssistant = true;
        for (const part of msg.parts || []) {
          if (part.type === 'text' && part.text) {
            text = part.text;
          }
          if (part.type === 'tool' && part.state?.status === 'completed') {
            toolCalls++;
          }
        }
      }
    }

    if (hasAssistant && text) {
      log.info(`OpenCode response ready: ${text.length} chars, ${toolCalls} tool calls`);
      break;
    }
  }

  if (!text) {
    text = 'OpenCode session timed out without a response.';
  }

  return { text, sessionId, toolCalls };
}
