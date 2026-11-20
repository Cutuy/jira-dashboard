import { render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

function mockDashboard(suggestionsEnabled: boolean, ticketResponse: unknown = { tickets: [] }) {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const responses = {
    '/api/config': { projectName: 'Test dashboard', suggestionsEnabled },
    '/api/system/checks': [],
    '/api/tickets': ticketResponse,
    '/api/suggestions': [{ id: 'sug-example', title: 'Review the release notes', content: 'Check the next release' }],
  }
  const fetch = vi.fn(async (url: keyof typeof responses) => Response.json(responses[url]))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

it('keeps suggestions off while loading config and when they are disabled', async () => {
  const fetch = mockDashboard(false)
  render(<App />)
  expect(screen.queryByText('Loading suggestions…')).toBeNull()
  await screen.findByRole('heading', { name: 'Test dashboard' })
  expect(fetch.mock.calls.some(([url]) => url === '/api/suggestions')).toBe(false)
  expect(screen.queryByText('Loading suggestions…')).toBeNull()
  expect(screen.queryByText('Review the release notes')).toBeNull()
})

it('loads and displays suggestions when the dashboard opts in', async () => {
  mockDashboard(true)
  render(<App />)
  expect(await screen.findByText('Review the release notes')).toBeTruthy()
  expect(screen.queryByText('Loading suggestions…')).toBeNull()
})

it('shows imported Jira columns in order and keeps distinct review columns', async () => {
  const ticket = (id: string, title: string, stage = 'review') => ({
    id, title, stage, status: 'idle', updated_at: new Date().toISOString(),
  })
  mockDashboard(false, {
    tickets: [
      ticket('review', 'Review ticket'),
      ticket('human', 'Human review ticket'),
      ticket('closed', 'Closed locally', 'done'),
      ticket('native', 'Native ticket', 'clarification'),
    ],
    jiraBoards: [{
      id: 'board-1',
      title: 'Imported board',
      columns: [
        { id: '0', name: 'Ready for work', statuses: [{ id: 'open', stage: 'clarification' }] },
        { id: '1', name: 'Automated review', statuses: [{ id: 'review', stage: 'review' }] },
        { id: '2', name: 'Human review', statuses: [{ id: 'human', stage: 'review' }] },
        { id: '3', name: 'Delivered', statuses: [{ id: 'done', stage: 'done' }] },
      ],
      tickets: [
        { ticketId: 'review', statusId: 'review', importedStage: 'review' },
        { ticketId: 'human', statusId: 'human', importedStage: 'review' },
        { ticketId: 'closed', statusId: 'human', importedStage: 'review' },
      ],
    }],
  })
  render(<App />)
  const board = await screen.findByRole('region', { name: 'Imported board' })
  expect(within(board).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
    .toEqual(['Ready for work', 'Automated review', 'Human review', 'Delivered'])
  const column = (name: string) => within(within(board).getByRole('region', { name }))
  expect(column('Ready for work').getByText('No tickets')).toBeTruthy()
  expect(column('Automated review').getByText('Review ticket')).toBeTruthy()
  expect(column('Human review').getByText('Human review ticket')).toBeTruthy()
  expect(column('Delivered').getByText('Closed locally')).toBeTruthy()
  expect(screen.getAllByText('Human review ticket')).toHaveLength(1)
  expect(within(screen.getByRole('region', { name: 'Clarification' })).getByText('Native ticket')).toBeTruthy()
})
