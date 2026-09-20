import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-sonnet-4-20250514-v1:0';

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Reason codes for a failed Bedrock invocation (row 19 probe shares this
 * classification). Never guess: an unknown error maps to UNKNOWN, not to a
 * plausible-looking guess.
 */
export type BedrockFailureReason =
  | 'CREDENTIALS_MISSING'
  | 'AUTH_DENIED'
  | 'THROTTLED'
  | 'MODEL_NOT_FOUND'
  | 'NETWORK'
  | 'UNKNOWN';

export class BedrockUnavailableError extends Error {
  readonly reason: BedrockFailureReason;
  constructor(reason: BedrockFailureReason, detail: string) {
    super(`Bedrock unavailable (${reason}): ${detail}`);
    this.name = 'BedrockUnavailableError';
    this.reason = reason;
  }
}

export function classifyBedrockError(e: unknown): BedrockFailureReason {
  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY) {
    return 'CREDENTIALS_MISSING';
  }
  const name = (e as { name?: string }).name || '';
  const message = ((e as Error).message || '').toLowerCase();
  if (name.includes('AccessDenied') || message.includes('access denied') || message.includes('not authorized') || message.includes('security token')) {
    return 'AUTH_DENIED';
  }
  if (name.includes('Throttling') || message.includes('throttl')) {
    return 'THROTTLED';
  }
  if (message.includes('not found') || message.includes('no such model')) {
    return 'MODEL_NOT_FOUND';
  }
  if (message.includes('network') || message.includes('econnrefused') || message.includes('etimedout') || message.includes('socket')) {
    return 'NETWORK';
  }
  return 'UNKNOWN';
}

export async function invokeClaude(
  systemPrompt: string,
  messages: BedrockMessage[],
  maxTokens: number = 2000
): Promise<string> {
  try {
    const claudeRequest = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    };

    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(claudeRequest),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.content[0].text;
  } catch (bedrockError) {
    // Row 18: the previous behavior on this path fabricated a canned incident
    // response. Fail loudly instead; callers decide whether to degrade.
    const reason = classifyBedrockError(bedrockError);
    const detail = (bedrockError as Error).message || String(bedrockError);
    console.warn(`Bedrock invocation failed (${reason}):`, detail);
    throw new BedrockUnavailableError(reason, detail);
  }
}

export async function invokeClaudeJSON<T>(
  systemPrompt: string,
  messages: BedrockMessage[],
  maxTokens: number = 2000
): Promise<T> {
  const text = await invokeClaude(systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no explanation.', messages, maxTokens);
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in LLM response');
  return JSON.parse(jsonMatch[0]) as T;
}
