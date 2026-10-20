/**
 * Live E2E check for the Jev decision router. Reads OPENROUTER_API_KEY from
 * web/.env.local (gitignored via `.env*`), sends one mock B2B sales email with
 * three questions mapping to Jev's primitives, and prints latency, cost and the
 * raw structured response.
 *
 * Run: pnpm tsx scripts/test_jev_router.ts
 */
import { askJev, readEnvKey, type JevQuestion } from './jev/jevRouter';

const ENV_FILE = 'web/.env.local';

const EMAIL = `Subject: Pricing for 500 seats before Q4 budget closes

Hi team,

We've been evaluating your platform against two competitors. Our CFO has
approved budget for 500 seats if we can get a signed order form by 31 October.
Could you send over an enterprise quote and confirm whether SSO and audit
logging are included? Happy to jump on a call with our procurement lead.

Thanks,
Dana, VP Operations, Northwind Logistics`;

const questions: Record<string, JevQuestion> = {
  lead_strength: {
    type: 'score',
    instructions: 'How strong is this inbound sales lead?',
    criteria: [
      'Cold or no buying intent',
      'Early interest, no budget or timeline',
      'Qualified interest with budget or timeline',
      'Ready to buy now with budget and a deadline',
    ],
  },
  email_category: {
    type: 'choice',
    instructions: 'Which category best describes this email?',
    criteria: {
      sales_inquiry: 'Prospect asking for pricing, quotes or a sales call.',
      support_request: 'Existing customer reporting a problem or asking for help.',
      partnership: 'Proposal to partner, resell or integrate.',
      spam_or_marketing: 'Unsolicited vendor marketing or mass outreach.',
    },
  },
  requires_personal_reply: {
    type: 'noul',
    instructions: 'Does this email require a personal, human reply from a sales rep?',
    criteria: {
      true: 'The sender asks a direct question or requests a call, quote or commitment.',
      false: 'Automated notice, newsletter, or a message needing no reply.',
    },
  },
};

async function main(): Promise<void> {
  const apiKey = readEnvKey(ENV_FILE, 'OPENROUTER_API_KEY');
  const { response, latencyMs } = await askJev(apiKey, questions, { email: EMAIL });

  console.log(`latency_ms: ${latencyMs}`);
  console.log(`model: ${response.model} (provider: ${response.provider})`);
  const { input_tokens: promptCount, output_tokens: completionCount } = response.usage;
  console.log(`usage: input=${promptCount} output=${completionCount} (counts)`);
  console.log(`cost_usd: ${response.usage.cost}`);
  console.log('answers:');
  console.log(JSON.stringify(response.answers, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
