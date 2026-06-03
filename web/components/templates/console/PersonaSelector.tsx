'use client';

import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import type { PersonaId } from '@/lib/types/synthesis-nucleus';

export const PERSONAS: { id: PersonaId; label: string; icon: string; description: string }[] = [
  {
    id: 'creator',
    label: 'Creator',
    icon: 'solar:pen-bold-linear',
    description: 'Production & monetization insights'
  },
  {
    id: 'critic',
    label: 'Critic',
    icon: 'solar:shield-check-linear',
    description: 'Flaws & improvement areas'
  },
  {
    id: 'analyst',
    label: 'Analyst',
    icon: 'solar:magnifer-linear',
    description: 'Data & quantitative breakdown'
  },
  {
    id: 'educator',
    label: 'Educator',
    icon: 'solar:graduation-cap-linear',
    description: 'Learning & teaching potential'
  },
  {
    id: 'philosopher',
    label: 'Philosopher',
    icon: 'solar:crown-minimalistic-linear',
    description: 'Ideas & deeper meaning'
  }
];

export function PersonaSelector() {
  const { activePersona, switchPersona } = useSynthesisNucleus();

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
      {PERSONAS.map(persona => (
        <button
          key={persona.id}
          onClick={() => switchPersona(persona.id)}
          title={persona.description}
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
          <span style={{ fontSize: 14 }}>●</span>
          {persona.label}
        </button>
      ))}
    </div>
  );
}
