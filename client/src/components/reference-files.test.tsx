import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReferenceFiles from './reference-files'

type Entry = { name: string; type: 'file' | 'folder'; preview?: 'markdown' | 'pdf' }

function mockFiles() {
  const entries = new Map<string, Entry[]>([
    ['', [{ name: 'Planning', type: 'folder' }]],
    ['Planning', [{ name: 'Original.md', type: 'file', preview: 'markdown' }]],
  ])
  const uploads: { folder: string; file: File }[] = []
  const folders: { folder: string; name: string }[] = []
  const respond = (value: unknown, status = 200) => Response.json(value, { status })
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    const { pathname, searchParams } = new URL(input, 'http://dashboard.test')
    const folder = searchParams.get('folder') || ''
    if (pathname === '/api/files') {
      return respond({ folderPath: `C:\\project\\.jira-dashboard\\reference\\${folder}`, entries: entries.get(folder) })
    }
    if (pathname === '/api/files/folders') {
      const entry = JSON.parse(options?.body as string)
      folders.push(entry)
      entries.get(entry.folder)?.push({ name: entry.name, type: 'folder' })
      entries.set([entry.folder, entry.name].filter(Boolean).join('/'), [])
      return respond({ name: entry.name }, 201)
    }
    if (options?.method === 'PUT') {
      const file = options.body as File
      uploads.push({ folder, file })
      const items = entries.get(folder)!
      if (items.some(entry => entry.name === file.name)) return respond({ error: 'A file or folder with this name already exists.' }, 409)
      items.push({ name: file.name, type: 'file', preview: file.name.endsWith('.pdf') ? 'pdf' : 'markdown' })
      return respond({ name: file.name }, 201)
    }
    return new Response('# Release plan\n\n**Ready**\n\n<script>injected markup</script>')
  }))
  return { uploads, folders }
}

afterEach(() => vi.unstubAllGlobals())

describe('ReferenceFiles', () => {
  it('opens the file picker and copies a selected file to the open folder', async () => {
    const { uploads } = mockFiles()
    render(<ReferenceFiles />)
    fireEvent.click(await screen.findByRole('button', { name: 'Planning' }))
    await screen.findByRole('button', { name: 'Original.md' })

    const input = screen.getByLabelText('Files to copy')
    const openPicker = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Copy', exact: true }))
    expect(openPicker).toHaveBeenCalledOnce()

    const file = new File(['# Release plan'], 'Release plan & notes.md')
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: file.name }))
    expect(uploads).toEqual([{ folder: 'Planning', file }])
    expect(await screen.findByRole('heading', { name: 'Release plan' })).toBeTruthy()
    expect(screen.getByText('Ready').tagName).toBe('STRONG')
    expect(screen.queryByText('injected markup')).toBeNull()
  })

  it('copies dropped files into the open folder and reports per-file conflicts', async () => {
    const { uploads } = mockFiles()
    render(<ReferenceFiles />)
    fireEvent.click(await screen.findByRole('button', { name: 'Planning' }))
    await screen.findByRole('button', { name: 'Original.md' })

    const pdf = new File(['%PDF-1.7'], 'Design overview.pdf')
    const duplicate = new File(['replacement'], 'Original.md')
    fireEvent.drop(screen.getByRole('region', { name: 'File drop area' }), {
      dataTransfer: { types: ['Files'], files: [pdf, duplicate] },
    })
    expect((await screen.findByRole('alert')).textContent).toContain('Original.md')
    expect(screen.getByRole('status').textContent).toBe('Copied 1 file.')
    expect(uploads).toEqual([{ folder: 'Planning', file: pdf }, { folder: 'Planning', file: duplicate }])
    fireEvent.click(await screen.findByRole('button', { name: pdf.name }))
    expect(screen.getByTitle(pdf.name).getAttribute('src')).toBe('/api/files/content?path=Planning%2FDesign+overview.pdf')
  })

  it('opens a newly created folder as the copy destination', async () => {
    const { folders } = mockFiles()
    render(<ReferenceFiles />)
    await screen.findByRole('button', { name: 'Planning' })
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Specifications' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    expect(await screen.findByText('This folder is empty.')).toBeTruthy()
    expect(screen.getByText('Specifications').getAttribute('aria-current')).toBe('location')
    expect(folders).toEqual([{ folder: '', name: 'Specifications' }])
  })
})
