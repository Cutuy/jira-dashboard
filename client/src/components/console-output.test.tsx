import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConsoleOutput } from './console-output'

describe('ConsoleOutput', () => {
  it('renders nothing when lines is empty', () => {
    const { container } = render(<ConsoleOutput lines={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders joined lines', () => {
    const { container } = render(<ConsoleOutput lines={['line1\n', 'line2\n']} />)
    expect(container.textContent).toBe('line1\nline2\n')
  })

  it('has the expected styling classes', () => {
    const { container } = render(<ConsoleOutput lines={['output']} />)
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('bg-zinc-950')
    expect(div.className).toContain('t-mono-12')
    expect(div.className).toContain('max-h-64')
  })
})
