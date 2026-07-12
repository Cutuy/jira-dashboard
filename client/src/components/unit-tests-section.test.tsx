import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UnitTestsSection } from './unit-tests-section'

describe('UnitTestsSection', () => {
  const baseTest = {
    status: 'pass',
    started_at: '2026-01-01T00:00:00Z',
  }

  it('renders nothing when test is null', () => {
    const { container } = render(
      <UnitTestsSection test={null} onRerun={() => {}} rerunning={false} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders the section title', () => {
    render(
      <UnitTestsSection test={baseTest} onRerun={() => {}} rerunning={false} />
    )
    expect(screen.getByText('Unit tests')).toBeTruthy()
  })

  it('shows passed hint for passing tests', () => {
    render(
      <UnitTestsSection test={baseTest} onRerun={() => {}} rerunning={false} />
    )
    expect(screen.getByText('passed')).toBeTruthy()
  })

  it('shows failed hint for failing tests', () => {
    render(
      <UnitTestsSection test={{ ...baseTest, status: 'fail' }} onRerun={() => {}} rerunning={false} />
    )
    expect(screen.getByText('failed')).toBeTruthy()
  })

  it('renders id div when provided', () => {
    const { container } = render(
      <UnitTestsSection test={baseTest} onRerun={() => {}} rerunning={false} id="tests-panel" />
    )
    expect(container.querySelector('#tests-panel')).toBeTruthy()
  })
})
