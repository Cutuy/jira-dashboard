import { GitPullRequest, ExternalLink } from 'lucide-react'

function prNumberFromUrl(url: string): number | null {
  const m = url.match(/\/pull\/(\d+)(?:$|[/?#])/)
  return m ? Number(m[1]) : null
}

interface PrBannerProps {
  prUrl: string
  prState: string | null | undefined
  commitSha: string | null | undefined
}

export function PrBanner({ prUrl, prState, commitSha }: PrBannerProps) {
  const isMerged = prState === 'merged'
  const isClosed = prState === 'closed'

  return (
    <div className={`rounded-lg border p-3.5 flex items-start gap-2.5 ${
      isMerged ? 'border-violet-200 bg-violet-50' :
      isClosed ? 'border-red-200 bg-red-50' :
      'border-emerald-200 bg-emerald-50'
    }`}>
      <GitPullRequest className={`h-4 w-4 mt-0.5 shrink-0 ${
        isMerged ? 'text-violet-600' :
        isClosed ? 'text-red-600' :
        'text-emerald-600'
      }`} />
      <div className={`t-body ${
        isMerged ? 'text-violet-900' :
        isClosed ? 'text-red-900' :
        'text-emerald-900'
      }`}>
        {isMerged ? 'PR merged' : isClosed ? 'PR closed' : 'PR opened'}
        {' · '}
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          className={`font-medium underline underline-offset-2 inline-flex items-center gap-1 ${
            isMerged ? 'text-violet-700 hover:text-violet-600' :
            isClosed ? 'text-red-700 hover:text-red-600' :
            'text-emerald-700 hover:text-emerald-600'
          }`}
        >
          {prNumberFromUrl(prUrl) != null ? `#${prNumberFromUrl(prUrl)}` : 'View PR'}
          <ExternalLink className="h-3 w-3" />
        </a>
        {' · Commit '}
        <code className={`t-mono-12 ${
          isMerged ? 'text-violet-800' :
          isClosed ? 'text-red-800' :
          'text-emerald-800'
        }`}>{commitSha}</code>
      </div>
    </div>
  )
}
