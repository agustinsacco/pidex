import { useEffect, useState } from 'react'
import clsx from 'clsx'

/**
 * Small form primitives shared by the settings tabs: labelled rows, a switch,
 * and numeric/text fields that commit on blur or Enter.
 */

export function SectionTitle({
  children,
  small,
}: {
  children: React.ReactNode
  small?: boolean
}): React.JSX.Element {
  return (
    <h2 className={clsx('font-semibold', small ? 'mb-2 mt-6 text-[13px]' : 'mb-4 text-[16px]')}>
      {children}
    </h2>
  )
}

export function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="border-border flex items-center justify-between gap-6 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {description && (
          <div className="text-text-tertiary mt-0.5 text-[11.5px] leading-snug">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Toggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={clsx(
        'relative h-[22px] w-10 rounded-full transition-colors',
        on ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all',
          on ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  suffix?: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
        className="border-border bg-surface text-text w-24 rounded-lg border px-2.5 py-1.5 text-right text-[12.5px] outline-none"
      />
      {suffix && <span className="text-text-tertiary text-[11.5px]">{suffix}</span>}
    </span>
  )
}

export function TextField({
  defaultValue,
  placeholder,
  onCommit,
}: {
  defaultValue: string
  placeholder?: string
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(defaultValue)
  useEffect(() => setValue(defaultValue), [defaultValue])
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== defaultValue) onCommit(value.trim())
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="border-border bg-surface text-text placeholder:text-text-tertiary w-56 rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
    />
  )
}
