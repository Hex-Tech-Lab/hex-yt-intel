import type { PersonaId } from './types/persona';
export type { PersonaId, PersonaProjection, PersonaConfigV2 } from './types/persona';
export { PERSONA_DIMENSIONS, isValidPersona } from './types/persona';

export interface PersonaConfiguration {
  personaId: PersonaId;
  name: string;
  weight: number;
}

const PERSONA_REGISTRY: Record<PersonaId, string> = {
  creator: 'Content Creator',
  indieMaker: 'Indie Maker',
  consultant: 'Consultant',
  researcher: 'Researcher',
  productManager: 'Product Manager',
};

/**
 * Persona auto-detection using domain-signal keywords
 * Falls back to creator (Content Creator) if no match
 */
export function detectPersona(title: string, author: string): PersonaId {
  const text = `${title} ${author}`.toLowerCase();

  const patterns: Record<PersonaId, RegExp> = {
    creator: /content|creator|youtube|video|channel|viral|engagement|audience|subscriber|hack|growth|algorithm/,
    indieMaker: /startup|founder|saas|indiehacker|bootstrap|mrr|product-market|validation|launch|indie|maker/,
    consultant: /strategy|framework|consulting|business|advisory|implementation|process|management|case-study/,
    researcher: /research|study|scientific|academic|analysis|data|methodology|evidence|literature|peer-reviewed|experiment|hypothesis/,
    productManager: /product|roadmap|prioriti(?:es|zation)?|feature|user|customer|requirements|design|ux|pm/,
  };

  for (const [persona, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      return persona as PersonaId;
    }
  }

  return 'creator';
}

/**
 * Persona ranking based on detected primary
 * Returns weighted secondary/tertiary personas
 */
export function rankPersonas(primary: PersonaId): PersonaConfiguration[] {
  const allPersonas: PersonaId[] = ['creator', 'indieMaker', 'consultant', 'researcher', 'productManager'];
  const ordered: PersonaId[] = [primary, ...allPersonas.filter((p) => p !== primary)];

  return [
    { personaId: ordered[0]!, name: PERSONA_REGISTRY[ordered[0]!], weight: 50 },
    { personaId: ordered[1]!, name: PERSONA_REGISTRY[ordered[1]!], weight: 25 },
    { personaId: ordered[2]!, name: PERSONA_REGISTRY[ordered[2]!], weight: 15 },
    { personaId: ordered[3]!, name: PERSONA_REGISTRY[ordered[3]!], weight: 5 },
    { personaId: ordered[4]!, name: PERSONA_REGISTRY[ordered[4]!], weight: 5 },
  ];
}
