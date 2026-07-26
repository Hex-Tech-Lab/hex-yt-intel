'use client';

import { Tooltip } from '@astryxdesign/core';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { Icon } from '@/components/templates/_shared/primitives';
import type { PersonaId } from '@/lib/types/persona';

// The PRD's primary 5 personas (UCIS P1–P5). The Content Creator (P1) is the apex
// persona and consumes ALL 11 dimensions. Underlying ids are kept stable to avoid
// churning the prompt/validator plumbing; only labels + dimension projections change.
export const PERSONAS: { id: PersonaId; label: string; icon: string; description: string }[] = [
  {
    id: 'creator',
    label: 'Content Creator',
    icon: 'solar:videocamera-record-linear',
    description: 'P1 · the full picture — all 11 dimensions'
  },
  {
    id: 'indieMaker',
    label: 'Indie Maker',
    icon: 'solar:rocket-2-linear',
    description: 'P2 · build, ship & monetize'
  },
  {
    id: 'consultant',
    label: 'Consultant',
    icon: 'solar:case-round-linear',
    description: 'P3 · positioning & credibility'
  },
  {
    id: 'researcher',
    label: 'Researcher',
    icon: 'solar:graduation-cap-linear',
    description: 'P4 · evidence & forward signals'
  },
  {
    id: 'productManager',
    label: 'Product Manager',
    icon: 'solar:widget-add-linear',
    description: 'P5 · architecture & roadmap'
  }
];

export function PersonaSelector() {
  const { activePersona, switchPersona } = useSynthesisNucleus();

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
      {PERSONAS.map(persona => (
        <Tooltip key={persona.id} content={persona.description}>
          <button
            onClick={() => switchPersona(persona.id)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: activePersona === persona.id ? 'var(--accent)' : 'var(--surface)',
              color: activePersona === persona.id ? 'var(--void)' : 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 500,
              transition: 'all var(--dur-base)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
            aria-pressed={activePersona === persona.id}
          >
            <Icon icon={persona.icon} size={14} />
            {persona.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
