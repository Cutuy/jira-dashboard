import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResourceUsageSection } from './resource-usage-section'

describe('ResourceUsageSection', () => {
  const baseProps = {
    activity: [],
    stageResources: null,
    status: 'idle',
  }

  it('renders the section title', () => {
    render(<ResourceUsageSection {...baseProps} />)
    expect(screen.getByText('Resource usage')).toBeTruthy()
  })

  it('renders ResourceMetrics with provided props', () => {
    const { container } = render(<ResourceUsageSection {...baseProps} />)
    expect(container.querySelector('.rounded-md.ring-1.ring-border.p-3')).toBeTruthy()
  })
})
