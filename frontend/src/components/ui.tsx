import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

const HUES = [262, 199, 330, 160, 24, 222, 290, 180]

function hueFor(seed: string) {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]
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
  const hue = hueFor(seed)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={clsx('grid h-full w-full place-items-center font-semibold text-white', group ? 'rounded-[30%]' : 'rounded-full')}
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 75% 45%))`,
          fontSize: size * 0.38,
        }}
      >
        {initials || '?'}
      </div>
      {online !== undefined && (
        <span
          className={clsx(
            'absolute right-0 bottom-0 rounded-full ring-[3px] ring-ink-900 transition-colors',
            online ? 'bg-emerald-400' : 'bg-ink-600',
          )}
          style={{ width: size * 0.28, height: size * 0.28 }}
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
        'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-gradient text-white shadow-lg shadow-brand-600/25 hover:brightness-110 active:brightness-95',
        variant === 'ghost' && 'text-ink-200 hover:bg-white/5 hover:text-white',
        variant === 'subtle' && 'bg-white/[0.06] text-ink-100 hover:bg-white/10',
        variant === 'danger' && 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
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
        'grid h-10 w-10 place-items-center rounded-xl text-ink-300 transition hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none disabled:opacity-40',
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
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-300">{label}</span>
      <input
        {...rest}
        className={clsx(
          'h-11 w-full rounded-xl border bg-ink-950/60 px-3.5 text-[15px] text-white placeholder:text-ink-400 transition outline-none',
          error ? 'border-rose-400/60' : 'border-white/[0.08] focus:border-brand-400/70 focus:bg-ink-950',
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx('glass w-full animate-rise rounded-2xl shadow-2xl', wide ? 'max-w-lg' : 'max-w-md')}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2 h-8 w-8">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export function Logo({ size = 36 }: { size?: number }) {
  return <img src="/favicon.svg" width={size} height={size} alt="" className="shrink-0 drop-shadow-[0_6px_18px_rgba(139,92,246,0.45)]" />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin text-ink-400', className ?? 'h-5 w-5')} />
}

export function ErrorNote({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">{children}</div>
}
