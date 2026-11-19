import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronRight, Copy, Download, FileText, Folder, FolderPlus, RefreshCw, Upload } from 'lucide-react'
import Markdown from 'react-markdown'
import { Btn } from './ui/dashboard-button'

type ReferenceFile = { name: string; type: 'file'; preview: 'markdown' | 'pdf' | 'text' | null }
type Entry = ReferenceFile | { name: string; type: 'folder' }
type FolderListing = { folderPath: string; entries: Entry[] }
type Notice = { status: string; errors: string[] }

function fileUrl(endpoint: string, params: Record<string, string>) {
  return `/api/files${endpoint}?${new URLSearchParams(params)}`
}

async function filesRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || 'Could not access the reference files.')
  }
  return response
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function FilePreview({ file, filePath }: { file: ReferenceFile; filePath: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const source = fileUrl('/content', { path: filePath })

  useEffect(() => {
    if (file.preview !== 'markdown' && file.preview !== 'text') return
    const controller = new AbortController()
    filesRequest(source, { signal: controller.signal })
      .then(response => response.text())
      .then(content => { if (!controller.signal.aborted) setText(content) })
      .catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)) })
    return () => controller.abort()
  }, [file.preview, source])

  if (file.preview === 'pdf') {
    return <iframe src={source} title={file.name} className="block w-full min-h-[68vh] bg-surface-2" />
  }
  if (!file.preview) return <p className="p-5 t-body text-ink-2">Download this file to open it.</p>
  if (error) return <p role="alert" className="p-5 t-body text-danger">{error}</p>
  if (text === null) return <p role="status" className="p-5 t-body text-ink-2">Loading preview…</p>
  if (!text) return <p className="p-5 t-body text-ink-2">This file is empty.</p>
  if (file.preview === 'text') {
    return <pre className="p-5 whitespace-pre-wrap break-words t-mono-12">{text}</pre>
  }
  return (
    <article className="reference-markdown p-5 sm:p-6 break-words t-body">
      <Markdown skipHtml components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        img: ({ alt }) => alt ? <span>{alt}</span> : null,
      }}>
        {text}
      </Markdown>
    </article>
  )
}

export default function ReferenceFiles() {
  const [folder, setFolder] = useState<string[]>([])
  const [loaded, setLoaded] = useState<{ key: string; data: FolderListing } | null>(null)
  const [revision, setRevision] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [folderName, setFolderName] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const folderKey = folder.join('/')
  const listing = loaded?.key === folderKey ? loaded.data : null
  const selected = listing?.entries.find((entry): entry is ReferenceFile => entry.type === 'file' && entry.name === selectedName)
  const selectedPath = [...folder, selectedName].join('/')
  const refresh = () => setRevision(current => current + 1)

  useEffect(() => {
    const controller = new AbortController()
    setLoadError('')
    filesRequest(fileUrl('', { folder: folderKey }), { signal: controller.signal })
      .then(response => response.json())
      .then((data: FolderListing) => {
        if (!controller.signal.aborted) setLoaded({ key: folderKey, data })
      })
      .catch(err => {
        if (!controller.signal.aborted) setLoadError(errorMessage(err))
      })
    return () => controller.abort()
  }, [folderKey, revision])

  function openFolder(parts: string[]) {
    setFolder(parts)
    setSelectedName('')
    setFolderName(null)
    setNotice(null)
  }

  async function copyFiles(files: File[]) {
    if (busy || !listing || files.length === 0) return
    setBusy(true)
    setNotice({ status: 'Copying files…', errors: [] })
    const errors: string[] = []
    let copied = 0
    for (const file of files) {
      try {
        await filesRequest(fileUrl('/content', { folder: folderKey, name: file.name }), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        })
        copied++
      } catch (err) {
        errors.push(`${file.name} — ${errorMessage(err)}`)
      }
    }
    setNotice({ status: copied ? `Copied ${copied} ${copied === 1 ? 'file' : 'files'}.` : '', errors })
    setBusy(false)
    refresh()
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = folderName?.trim()
    if (busy || !name) return
    setBusy(true)
    setNotice(null)
    try {
      await filesRequest('/api/files/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderKey, name }),
      })
      openFolder([...folder, name])
    } catch (err) {
      setNotice({ status: '', errors: [errorMessage(err)] })
    } finally {
      setBusy(false)
    }
  }

  async function copyPath(name: string) {
    if (!listing) return
    const separator = listing.folderPath.includes('\\') ? '\\' : '/'
    try {
      await navigator.clipboard.writeText(listing.folderPath + separator + name)
      setNotice({ status: 'File path copied.', errors: [] })
    } catch {
      setNotice({ status: '', errors: ['The browser could not copy the file path.'] })
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="files-title"
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = busy || !listing ? 'none' : 'copy'
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={event => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        if (busy || !listing) return
        if (Array.from(event.dataTransfer.items ?? []).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
          setNotice({ status: '', errors: ['Select individual files to copy.'] })
          return
        }
        void copyFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id="files-title" className="t-h">Files</h2>
          <nav aria-label="Destination folder" className="flex flex-wrap items-center gap-1 t-body">
            {['Reference', ...folder].map((name, index) => (
              <span key={index} className="inline-flex items-center gap-1">
                {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-3" />}
                {index === folder.length
                  ? <span aria-current="location" className="font-medium break-all">{name}</span>
                  : <button type="button" onClick={() => openFolder(folder.slice(0, index))} disabled={busy}
                      className="rounded text-ink-2 hover:underline disabled:opacity-50">{name}</button>}
              </span>
            ))}
          </nav>
          {listing && <p className="break-all t-mono-11 text-ink-2">{listing.folderPath}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="ghost" aria-label="Refresh files" onClick={refresh} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
          </Btn>
          <Btn variant="outline" onClick={() => setFolderName('')} disabled={busy || !listing}>
            <FolderPlus className="h-4 w-4" /> New folder
          </Btn>
          <Btn onClick={() => input.current?.click()} disabled={busy || !listing}>
            <Copy className="h-4 w-4" /> Copy
          </Btn>
          <input ref={input} type="file" multiple hidden aria-label="Files to copy"
            onChange={event => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void copyFiles(files)
            }}
          />
        </div>
      </header>

      {folderName !== null && (
        <form onSubmit={createFolder} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface p-3 ring-1 ring-border">
          <label htmlFor="reference-folder-name" className="t-body font-medium">Folder name</label>
          <input id="reference-folder-name" autoFocus required maxLength={255} value={folderName} disabled={busy}
            onChange={event => setFolderName(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md bg-surface px-3 ring-1 ring-border t-body"
          />
          <Btn type="submit" disabled={busy || !folderName.trim()}>Create folder</Btn>
          <Btn type="button" variant="ghost" disabled={busy} onClick={() => setFolderName(null)}>Cancel</Btn>
        </form>
      )}

      <div role="region" aria-label="File drop area" className={`flex min-h-16 items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center t-body ${
        dragging && !busy && listing ? 'border-stage-clarify bg-stage-clarify-bg text-ink-1' : 'border-border-strong bg-surface-2 text-ink-2'
      }`}>
        <Upload aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>Drop files here to copy them into this folder.</span>
      </div>

      {notice?.status && <p role="status" className="t-body text-ink-2">{notice.status}</p>}
      {!!notice?.errors.length && (
        <ul role="alert" className="space-y-1 rounded-lg bg-danger-bg p-3 t-body text-danger">
          {notice.errors.map((message, index) => <li key={index}>{message}</li>)}
        </ul>
      )}
      {loadError && <p role="alert" className="t-body text-danger">{loadError}</p>}
      {!listing && !loadError && <p role="status" className="t-body text-ink-2">Loading folder…</p>}

      {listing && (
        <div className="grid gap-4 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
          <section aria-label="Folder contents" className="self-start overflow-hidden rounded-lg bg-surface ring-1 ring-border">
            {listing.entries.length === 0
              ? <p className="p-4 t-body text-ink-2">This folder is empty.</p>
              : <ul className="divide-y divide-border">
                  {listing.entries.map(entry => (
                    <li key={entry.name}>
                      <button type="button" disabled={busy} aria-pressed={entry.type === 'file' ? selectedName === entry.name : undefined}
                        onClick={() => entry.type === 'folder' ? openFolder([...folder, entry.name]) : setSelectedName(entry.name)}
                        className={`flex w-full items-center gap-2 px-3 py-2.5 text-left t-body hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 disabled:opacity-60 ${selectedName === entry.name ? 'bg-surface-3 font-medium' : ''}`}
                      >
                        {entry.type === 'folder' ? <Folder className="h-4 w-4 shrink-0 text-ink-2" /> : <FileText className="h-4 w-4 shrink-0 text-ink-2" />}
                        <span className="min-w-0 flex-1 break-all">{entry.name}</span>
                        {entry.type === 'folder' && <ChevronRight className="h-4 w-4 shrink-0 text-ink-2" />}
                      </button>
                    </li>
                  ))}
                </ul>}
          </section>

          {selected && (
            <section aria-label="File preview" className="min-w-0 overflow-hidden rounded-lg bg-surface ring-1 ring-border">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
                <h3 className="min-w-0 break-all t-body font-semibold">{selected.name}</h3>
                <div className="flex shrink-0 items-center gap-2">
                  <Btn variant="ghost" size="sm" onClick={() => void copyPath(selected.name)}>Copy path</Btn>
                  <a href={fileUrl('/content', { path: selectedPath, download: '1' })} download
                    className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 t-body text-ink-2 hover:bg-surface-3 sm:h-7 sm:t-small">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                </div>
              </header>
              <FilePreview key={JSON.stringify([selectedPath, revision])} file={selected} filePath={selectedPath} />
            </section>
          )}
        </div>
      )}
    </section>
  )
}
