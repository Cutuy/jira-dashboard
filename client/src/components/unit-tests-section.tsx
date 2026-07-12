import { Section, TestReportPanel } from '../App'

interface UnitTestsSectionProps {
  test: {
    status: string
    framework?: string
    command?: string
    exit_code?: number
    summary?: string
    output?: string
    duration_ms?: number
    triggered_by?: string
    started_at: string
    finished_at?: string
  } | null
  onRerun: () => void
  rerunning: boolean
  autoExpandFail?: boolean
  id?: string
}

export function UnitTestsSection({ test, onRerun, rerunning, autoExpandFail, id }: UnitTestsSectionProps) {
  if (!test) return null

  const hint =
    test.status === 'pass' ? 'passed' :
    test.status === 'fail' ? 'failed' :
    test.status === 'running' ? 'running…' :
    test.status === 'skip' ? 'skipped' : undefined

  return (
    <Section title="Unit tests" hint={hint}>
      <div id={id}>
        <TestReportPanel
          test={test}
          onRerun={onRerun}
          rerunning={rerunning}
          autoExpandFail={autoExpandFail}
        />
      </div>
    </Section>
  )
}
