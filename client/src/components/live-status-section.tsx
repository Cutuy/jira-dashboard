import { Loader2 } from 'lucide-react'
import { Section, ResourceMetrics } from '../App'
import { ConsoleOutput } from './console-output'
import type { ReactNode } from 'react'

interface LiveStatusSectionProps {
  activity: { action: string; detail: string; time: string }[]
  stageResources: unknown
  status: string
  stdoutLines: string[]
  statusText: string
  children?: ReactNode
}

export function LiveStatusSection({
  activity, stageResources, status, stdoutLines, statusText, children,
}: LiveStatusSectionProps) {
  return (
    <Section title="Live status">
      <div className="flex items-center gap-2 t-body text-ink-2 mb-3">
        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
        {statusText}
      </div>
      <div className="rounded-lg ring-1 ring-border p-3">
        <ResourceMetrics activity={activity} stageResources={stageResources} status={status} />
      </div>
      <ConsoleOutput lines={stdoutLines} />
      {children}
    </Section>
  )
}
