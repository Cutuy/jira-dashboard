import { Section, ResourceMetrics } from '../App'

interface ResourceUsageSectionProps {
  activity: { action: string; detail: string; time: string }[]
  stageResources: unknown
  status: string
}

export function ResourceUsageSection({ activity, stageResources, status }: ResourceUsageSectionProps) {
  return (
    <Section title="Resource usage">
      <div className="rounded-md ring-1 ring-border p-3">
        <ResourceMetrics activity={activity} stageResources={stageResources} status={status} />
      </div>
    </Section>
  )
}
