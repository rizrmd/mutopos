import type { ReactNode } from '@lynx-js/react'

import { cn } from '@/lib/utils'

export function Card({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return <view className={cn('mp-card', className)}>{children}</view>
}

export function CardHeader({
  title,
  description,
  className,
  children,
}: {
  title?: string
  description?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <view className={cn('mp-card__header', className)}>
      {title ? <text className="mp-card__title">{title}</text> : null}
      {description ? (
        <text className="mp-card__desc">{description}</text>
      ) : null}
      {children}
    </view>
  )
}

export function CardContent({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return <view className={cn('mp-card__content', className)}>{children}</view>
}
