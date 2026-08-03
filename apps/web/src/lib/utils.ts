type ClassValue = string | number | null | false | undefined

/**
 * Join class names.
 *
 * The old `clsx` + `tailwind-merge` pair went away with Tailwind: Lynx styles
 * are hand-written CSS classes, so there are no conflicting utilities to
 * de-dupe — only falsy values to drop.
 */
export function cn(...inputs: ClassValue[]): string {
  let out = ''
  for (const input of inputs) {
    if (!input && input !== 0) continue
    out = out ? `${out} ${input}` : String(input)
  }
  return out
}
