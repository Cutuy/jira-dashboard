interface ConsoleOutputProps {
  lines: string[]
}

export function ConsoleOutput({ lines }: ConsoleOutputProps) {
  if (lines.length === 0) return null
  return (
    <div className="mt-3 rounded-md ring-1 ring-border bg-zinc-950 text-ink-3 p-3 max-h-64 overflow-y-auto t-mono-12 leading-relaxed whitespace-pre-wrap break-words">
      {lines.join('')}
    </div>
  )
}
