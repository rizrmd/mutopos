import type { ReactNode } from '@lynx-js/react'

import { cn } from '@/lib/utils'

export type ButtonVariant = 'default' | 'outline' | 'ghost'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

export type ButtonProps = {
  label?: string
  children?: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  disabled?: boolean
  className?: string
  labelClassName?: string
  onTap?: () => void
}

/**
 * Tappable button.
 *
 * Lynx has no `<button>` element and no `disabled` attribute on `<view>`, so
 * "disabled" is enforced by not calling the handler (and dimming the surface).
 * Text still has to live inside `<text>`, hence the `label` prop.
 */
export function Button({
  label,
  children,
  variant = 'default',
  size = 'default',
  block = false,
  disabled = false,
  className,
  labelClassName,
  onTap,
}: ButtonProps) {
  return (
    <view
      className={cn(
        'mp-btn',
        variant === 'outline' && 'mp-btn--outline',
        variant === 'ghost' && 'mp-btn--ghost',
        size === 'sm' && 'mp-btn--sm',
        size === 'lg' && 'mp-btn--lg',
        size === 'icon' && 'mp-btn--icon',
        block && 'mp-btn--block',
        disabled && 'is-disabled',
        className,
      )}
      bindtap={() => {
        'background only'
        if (disabled) return
        onTap?.()
      }}
    >
      {children}
      {label ? (
        <text className={cn('mp-btn__label', labelClassName)}>{label}</text>
      ) : null}
    </view>
  )
}
