import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, ICON_NAMES } from './Icon'

describe('Icon', () => {
  it('renders a decorative stroke-based svg for every registered name', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(12)
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg, `icon ${name}`).not.toBeNull()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg).toHaveAttribute('fill', 'none')
      expect(svg!.querySelector('path, circle')).not.toBeNull()
      unmount()
    }
  })

  it('defaults to 16px and honors an explicit size', () => {
    const { container, unmount } = render(<Icon name="close" />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '16')
    unmount()

    const { container: sized } = render(<Icon name="close" size={12} />)
    expect(sized.querySelector('svg')).toHaveAttribute('width', '12')
    expect(sized.querySelector('svg')).toHaveAttribute('height', '12')
  })
})
