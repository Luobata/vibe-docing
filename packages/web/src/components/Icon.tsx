import type { ReactNode } from 'react'

/**
 * Notion 式内联线性图标集：16px 网格、stroke 1.7、round cap/join。
 * 仅当前色（currentColor），无填充；装饰性图标统一 aria-hidden。
 */
const ICON_PATHS = {
  alert: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 5v3.4" />
      <path d="M8 11.2v.01" />
    </>
  ),
  back: <path d="M10.5 8h-7M6.8 4.6 3.4 8l3.4 3.4" />,
  check: <path d="M3 8.5l3.2 3.2L13 5" />,
  'chevron-right': <path d="M6 3.5 10.5 8 6 12.5" />,
  'chevron-down': <path d="M3.5 6 8 10.5 12.5 6" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  doc: (
    <>
      <path d="M4 1.8h5L11.5 4v10.2H4z" />
      <path d="M9 1.8V4h2.5" />
    </>
  ),
  arrange: (
    <path d="M1.9 1.9h4.6v4.6H1.9zM9.5 1.9h4.6v4.6H9.5zM1.9 9.5h4.6v4.6H1.9zM9.5 9.5h4.6v4.6H9.5z" />
  ),
  density: <path d="M2.5 3.6h11M2.5 8h7.6M2.5 12.4h4.2" />,
  eye: (
    <>
      <path d="M1.6 8S4 3.6 8 3.6 14.4 8 14.4 8 12 12.4 8 12.4 1.6 8 1.6 8z" />
      <circle cx="8" cy="8" r="1.7" />
    </>
  ),
  edit: <path d="M10.2 2.8l3 3L6 13l-3.6.6L3 10z" />,
  focus: (
    <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
  ),
  folder: (
    <path d="M1.9 3.6a1 1 0 0 1 1-1h3l1.4 1.6h6.8a1 1 0 0 1 1 1v7.2a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1z" />
  ),
  forward: <path d="M5.5 8h7M9.2 4.6 12.6 8l-3.4 3.4" />,
  history: (
    <>
      <path d="M2.8 8a5.2 5.2 0 1 1 1.5 3.7" />
      <path d="M2.8 12.2v-2.7h2.7" />
      <path d="M8 5.2V8l2 1.4" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.4V11" />
      <path d="M8 4.9v.01" />
    </>
  ),
  map: (
    <>
      <circle cx="3.8" cy="8" r="1.6" />
      <circle cx="12.2" cy="3.8" r="1.6" />
      <circle cx="12.2" cy="12.2" r="1.6" />
      <path d="M5.2 7.2 10.8 4.4M5.2 8.8l5.6 2.8" />
    </>
  ),
  minus: <path d="M3.4 8h9.2" />,
  note: (
    <>
      <path d="M4 1.8h5L11.5 4v10.2H4z" />
      <path d="M9 1.8V4h2.5" />
      <path d="M6 8h4M6 10.6h4" />
    </>
  ),
  plus: <path d="M8 3.4v9.2M3.4 8h9.2" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.4 10.4 13.6 13.6" />
    </>
  ),
  send: <path d="M14 2 7 9M14 2 9.5 14 7 9 2 6.5z" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.9v1.7M8 12.4v1.7M1.9 8h1.7M12.4 8h1.7M3.7 3.7l1.2 1.2M11.1 11.1l1.2 1.2M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2" />
    </>
  ),
  share: (
    <>
      <path d="M8 9.8V2.6M5.2 5.2 8 2.4l2.8 2.8" />
      <path d="M3.2 9.2v3.3a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V9.2" />
    </>
  ),
  trash: (
    <>
      <path d="M2.6 4h10.8" />
      <path d="M6.4 4V2.9a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9V4" />
      <path d="M12.4 4v8.6a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4V4" />
      <path d="M6.6 7v4M9.4 7v4" />
    </>
  ),
} as const satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICON_PATHS

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[]

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      viewBox="0 0 16 16"
      width={size}
    >
      {ICON_PATHS[name]}
    </svg>
  )
}
