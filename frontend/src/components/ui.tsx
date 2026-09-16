import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

// Muted, low-saturation avatar tones.
const TONES = ['#4a5a78', '#5b6e5d', '#7a5d5d', '#6a5f7c', '#5d6f78', '#7a6a55', '#566574', '#6d5a6e']

function toneFor(seed: string) {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]
}

export function Avatar({
  name,
  seed,
  size = 40,
  online,
  group,
}: {
  name: string
  seed: string
  size?: number
  online?: boolean
  group?: boolean
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={clsx('grid h-full w-full place-items-center font-medium text-white/90', group ? 'rounded-[25%]' : 'rounded-full')}
        style={{ background: toneFor(seed), fontSize: size * 0.36 }}
      >
        {initials || '?'}
      </div>
      {online !== undefined && (
        <span
          className={clsx(
            'absolute right-0 bottom-0 rounded-full ring-2 ring-ink-900 transition-colors',
            online ? 'bg-emerald-500' : 'bg-ink-600',
          )}
          style={{ width: Math.max(8, size * 0.24), height: Math.max(8, size * 0.24) }}
        />
      )}
    </div>
  )
}

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-500 text-white hover:bg-brand-600',
        variant === 'ghost' && 'text-ink-200 hover:bg-white/[0.05] hover:text-ink-100',
        variant === 'subtle' && 'border border-white/[0.08] bg-ink-850 text-ink-100 hover:bg-ink-800',
        variant === 'danger' && 'border border-white/[0.08] bg-ink-850 text-rose-300 hover:bg-rose-500/10',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function IconButton({
  className,
  label,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={clsx(
        'grid h-9 w-9 place-items-center rounded-md text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-ink-100 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-200">{label}</span>
      <input
        {...rest}
        className={clsx(
          'h-10 w-full rounded-md border bg-ink-850 px-3 text-sm text-ink-100 placeholder:text-ink-400 transition-colors outline-none',
          error ? 'border-rose-400/60' : 'border-white/[0.09] focus:border-brand-500',
        )}
      />
      {(error || hint) && <span className={clsx('mt-1.5 block text-xs', error ? 'text-rose-300' : 'text-ink-400')}>{error || hint}</span>}
    </label>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx('surface w-full animate-rise rounded-lg', wide ? 'max-w-lg' : 'max-w-md')}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2 h-8 w-8">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/favicon.svg" width={size} height={size} alt="" className="shrink-0" />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin text-ink-400', className ?? 'h-5 w-5')} />
}

export function ErrorNote({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <div className="rounded-md border border-rose-400/20 bg-rose-500/[0.08] px-3 py-2 text-sm text-rose-200">{children}</div>
}
