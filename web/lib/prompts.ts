export type PersonaId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5';

export interface PersonaConfiguration {
  personaId: PersonaId;
  name: string;
  weight: number;
}

const PERSONA_REGISTRY: Record<PersonaId, string> = {
  p1: 'Content Creator',
  p2: 'Indie Maker',
  p3: 'Consultant',
  p4: 'Researcher',
  p5: 'Product Manager',
};

/**
 * Persona auto-detection using domain-signal keywords
 * Falls back to p1 (Content Creator) if no match
 */
export function detectPersona(title: string, author: string): PersonaId {
  const text = `${title} ${author}`.toLowerCase();

  // Keyword patterns per persona (domain signals)
  const patterns: Record<PersonaId, RegExp> = {
    p1: /content|creator|youtube|video|channel|viral|engagement|audience|subscriber|hack|growth|algorithm/,
    p2: /startup|founder|saas|indiehacker|bootstrap|mrr|product-market|validation|launch|indie|maker/,
    p3: /strategy|framework|consulting|business|advisory|implementation|process|management|case-study/,
    p4: /research|study|scientific|academic|analysis|data|methodology|evidence|literature|peer-reviewed|experiment|hypothesis/,
    p5: /product|roadmap|prioriti(?:es|zation)?|feature|user|customer|requirements|design|ux|pm/,
  };

  for (const [persona, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      return persona as PersonaId;
    }
  }

  // Default fallback
  return 'p1';
}

/**
 * Persona ranking based on detected primary
 * Returns weighted secondary/tertiary personas
 */
export function rankPersonas(primary: PersonaId): PersonaConfiguration[] {
  const allPersonas: PersonaId[] = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const ordered: PersonaId[] = [primary, ...allPersonas.filter((p) => p !== primary)];

  return [
    { personaId: ordered[0]!, name: PERSONA_REGISTRY[ordered[0]!], weight: 50 },
    { personaId: ordered[1]!, name: PERSONA_REGISTRY[ordered[1]!], weight: 25 },
    { personaId: ordered[2]!, name: PERSONA_REGISTRY[ordered[2]!], weight: 15 },
    { personaId: ordered[3]!, name: PERSONA_REGISTRY[ordered[3]!], weight: 5 },
    { personaId: ordered[4]!, name: PERSONA_REGISTRY[ordered[4]!], weight: 5 },
  ];
}
