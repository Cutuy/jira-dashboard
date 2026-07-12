import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveStatusSection } from './live-status-section'

describe('LiveStatusSection', () => {
  const baseProps = {
    activity: [],
    stageResources: null,
    status: 'running',
    stdoutLines: [],
    statusText: 'Working…',
  }

  it('renders the section title', () => {
    render(<LiveStatusSection {...baseProps} />)
    expect(screen.getByText('Live status')).toBeTruthy()
  })

  it('renders the status text', () => {
    render(<LiveStatusSection {...baseProps} statusText="Processing answers…" />)
    expect(screen.getByText('Processing answers…')).toBeTruthy()
  })

  it('renders children when provided', () => {
    render(
      <LiveStatusSection {...baseProps}>
        <div data-testid="extra">extra content</div>
      </LiveStatusSection>
    )
    expect(screen.getByTestId('extra')).toBeTruthy()
  })
})
