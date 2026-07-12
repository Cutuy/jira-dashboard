import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImplementationPlanSection } from './implementation-plan-section'

describe('ImplementationPlanSection', () => {
  it('renders nothing when plan is null', () => {
    const { container } = render(
      <ImplementationPlanSection plan={null} estimatedComplexity={null} planNotes={null} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders the plan text', () => {
    render(
      <ImplementationPlanSection plan="do the thing" estimatedComplexity={null} planNotes={null} />
    )
    expect(screen.getByText('do the thing')).toBeTruthy()
  })

  it('shows complexity hint when provided', () => {
    render(
      <ImplementationPlanSection plan="plan" estimatedComplexity="high" planNotes={null} />
    )
    expect(screen.getByText('complexity: high')).toBeTruthy()
  })

  it('renders plan notes when provided', () => {
    render(
      <ImplementationPlanSection plan="plan" estimatedComplexity={null} planNotes="some notes" />
    )
    expect(screen.getByText('some notes')).toBeTruthy()
  })
})
