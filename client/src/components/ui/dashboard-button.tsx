import type { ButtonHTMLAttributes } from 'react'

export function Btn({
  variant = 'default', size = 'md', children, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'danger' | 'secondary'
  size?: 'sm' | 'md'
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium rounded-md ' +
    'transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20'
  const sizes = {
    sm: 'h-10 sm:h-7 px-3 sm:px-2.5 t-body sm:t-small',
    md: 'h-11 sm:h-9 px-4 sm:px-3 t-body',
  }
  const variants = {
    default:    'bg-brand text-brand-fg hover:bg-zinc-700',
    outline:    'bg-surface text-ink-2 ring-1 ring-border hover:bg-bg hover:text-ink-1',
    ghost:      'text-ink-2 hover:bg-surface-3 hover:text-ink-1',
    secondary:  'bg-surface-3 text-ink-2 hover:bg-surface-3',
    danger:     'bg-red-600 text-white hover:bg-red-700',
  }
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}
