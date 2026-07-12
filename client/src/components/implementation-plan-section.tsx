import { Section } from '../App'

interface ImplementationPlanSectionProps {
  plan: string | null
  estimatedComplexity: string | null
  planNotes: string | null
}

export function ImplementationPlanSection({ plan, estimatedComplexity, planNotes }: ImplementationPlanSectionProps) {
  if (!plan) return null
  return (
    <Section
      title="Implementation Plan"
      hint={estimatedComplexity ? `complexity: ${estimatedComplexity}` : undefined}
    >
      <pre className="rounded-md bg-zinc-900 text-zinc-100 p-3.5 t-mono-12 leading-relaxed whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
{plan}
      </pre>
      {planNotes && (
        <p className="t-small text-ink-3 mt-2 italic">{planNotes}</p>
      )}
    </Section>
  )
}
