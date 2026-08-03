/**
 * Icons.
 *
 * `lucide-react` renders React DOM `<svg>` trees, which do not exist in Lynx.
 * Lynx's `<svg>` element instead takes complete markup through its `content`
 * attribute — so the Lucide geometry is kept here as path data and the stroke
 * colour is interpolated in (there is no `currentColor` to inherit).
 */

export type IconName =
  | 'arrow-left'
  | 'banknote'
  | 'credit-card'
  | 'delete'
  | 'lock'
  | 'menu'
  | 'minus'
  | 'more-horizontal'
  | 'package'
  | 'percent'
  | 'plus'
  | 'receipt'
  | 'search'
  | 'shopping-bag'
  | 'smartphone'
  | 'trash'
  | 'wifi'
  | 'wifi-off'
  | 'x'

/** Lucide 24×24 geometry, stroke-based. */
const PATHS: Record<IconName, string> = {
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  banknote:
    '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01"/><path d="M18 12h.01"/>',
  'credit-card':
    '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  delete:
    '<path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6"/><path d="m12 9 6 6"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  minus: '<path d="M5 12h14"/>',
  'more-horizontal':
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  package:
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  percent:
    '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  receipt:
    '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'shopping-bag':
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  smartphone:
    '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
  'wifi-off':
    '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2.01-1.52"/><path d="M2 8.82a15 15 0 0 1 4.18-2.64"/><path d="M22 8.82a15 15 0 0 0-11.29-3.77"/><path d="m2 2 20 20"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
}

export type IconProps = {
  name: IconName
  /** Rendered box in px (icons are square). */
  size?: number
  /** Stroke colour — must be explicit; SVG content does not inherit CSS. */
  color?: string
  strokeWidth?: number
  className?: string
}

export function Icon({
  name,
  size = 16,
  color = 'currentColor',
  strokeWidth = 2,
  className,
}: IconProps) {
  const stroke = color === 'currentColor' ? '#6a7385' : color
  const content =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
    `stroke-linejoin="round">${PATHS[name]}</svg>`

  return (
    <svg
      className={className}
      content={content}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  )
}
