import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODEL = 'claude-sonnet-4-20250514';

interface CallClaudeParams {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
}

/**
 * Call Claude and return the text response.
 * All calls go through this wrapper for consistent logging and error handling.
 */
export async function callClaude(params: CallClaudeParams): Promise<string> {
  const { system, messages, maxTokens = 1024 } = params;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';

  logger.debug({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    model: MODEL,
  }, 'Claude API call');

  return text;
}

/**
 * Call Claude and parse the response as JSON.
 * Throws if the response is not valid JSON.
 */
export async function callClaudeJSON<T>(params: CallClaudeParams): Promise<T> {
  const text = await callClaude(params);
  try {
    return JSON.parse(text) as T;
  } catch {
    logger.error({ text }, 'Claude returned non-JSON response');
    throw new Error(`Claude did not return valid JSON: ${text.slice(0, 200)}`);
  }
}
