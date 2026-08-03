import type { ReactNode } from '@lynx-js/react'

import { cn } from '@/lib/utils'

export type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning'

export function Badge({
  label,
  variant = 'default',
  children,
  className,
}: {
  label: string
  variant?: BadgeVariant
  /** Leading content, e.g. an `<Icon />`. */
  children?: ReactNode
  className?: string
}) {
  return (
    <view
      className={cn(
        'mp-badge',
        variant === 'secondary' && 'mp-badge--secondary',
        variant === 'success' && 'mp-badge--success',
        variant === 'warning' && 'mp-badge--warning',
        className,
      )}
    >
      {children}
      <text className="mp-badge__text">{label}</text>
    </view>
  )
}
