import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

function mockDashboard(suggestionsEnabled: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const responses = {
    '/api/config': { projectName: 'Test dashboard', suggestionsEnabled },
    '/api/system/checks': [],
    '/api/tickets': { tickets: [] },
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
