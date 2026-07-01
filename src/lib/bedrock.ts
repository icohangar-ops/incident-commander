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

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-sonnet-4-20250514-v1:0';

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function invokeClaude(
  systemPrompt: string,
  messages: BedrockMessage[],
  maxTokens: number = 2000
): Promise<string> {
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
}

export async function invokeClaudeJSON<T>(
  systemPrompt: string,
  messages: BedrockMessage[],
  maxTokens: number = 2000
): Promise<T> {
  const text = await invokeClaude(systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no explanation.', messages, maxTokens);
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');
  return JSON.parse(jsonMatch[0]) as T;
}