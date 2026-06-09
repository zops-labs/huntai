interface HunterParams {
  stage: number;
  quote_description: string;
  owner_name: string;
  business_name: string;
  preferred_language: string;
  previous_contact_count: number;
}

export function buildHunterPrompt(params: HunterParams): string {
  return `
Generate a follow-up SMS (stage ${params.stage} of 3) for a pool maintenance quote.

Context:
- Business: ${params.business_name}
- Owner first name: ${params.owner_name}
- Quote was for: ${params.quote_description}
- Language: ${params.preferred_language === 'en' ? 'English' : 'Spanish'}
- This is follow-up number ${params.stage}

Tone rules by stage:
- Stage 1 (day 3): Friendly reminder. No pressure. Short.
- Stage 2 (day 7): Mention the season/heat. Slight urgency. Helpful.
- Stage 3 (day 14): Final message. Soft close. No hard sell.

Rules:
- Max 160 characters (one SMS)
- No emojis
- Sound human, not automated
- Do NOT include the opt-out text (added automatically)
- Return ONLY the message text. No JSON. No preamble.
`.trim();
}
