import { useRef, useState } from '@lynx-js/react'

import { cn } from '@/lib/utils'

export type TextFieldProps = {
  value: string
  onChangeText: (value: string) => void
  label?: string
  placeholder?: string
  /** Lynx input types — `digit` is the numeric-with-decimal keypad. */
  type?: 'text' | 'number' | 'digit' | 'password' | 'tel' | 'email'
  maxLength?: number
  className?: string
  inputClassName?: string
  onConfirm?: () => void
}

/**
 * Single-line text input with controlled-input semantics.
 *
 * Lynx's `<input>` is *uncontrolled*: there is no `value` prop, only
 * `default-value`, which is read once on mount and ignored afterwards. Changes
 * arrive on `bindinput` as `e.detail.value` rather than `e.target.value`.
 *
 * So this tracks the value it last reported upward; when the parent hands back
 * something different (prefilling the OTP with the stub code, clearing a field
 * after submit), the element is remounted under a new key so `default-value`
 * applies again. Typing never remounts, so the caret is never disturbed.
 */
export function TextField({
  value,
  onChangeText,
  label,
  placeholder,
  type = 'text',
  maxLength,
  className,
  inputClassName,
  onConfirm,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false)
  const lastReported = useRef(value)
  const generation = useRef(0)

  if (value !== lastReported.current) {
    // Value changed from the outside — force `default-value` to be re-read.
    lastReported.current = value
    generation.current += 1
  }

  return (
    <view className={cn('mp-field', className)}>
      {label ? <text className="mp-field__label">{label}</text> : null}
      <input
        key={`f${generation.current}`}
        className={cn('mp-input', focused && 'is-focused', inputClassName)}
        default-value={value}
        type={type}
        placeholder={placeholder}
        maxlength={maxLength}
        bindinput={(e) => {
          'background only'
          lastReported.current = e.detail.value
          onChangeText(e.detail.value)
        }}
        bindfocus={() => {
          'background only'
          setFocused(true)
        }}
        bindblur={() => {
          'background only'
          setFocused(false)
        }}
        bindconfirm={() => {
          'background only'
          onConfirm?.()
        }}
      />
    </view>
  )
}
