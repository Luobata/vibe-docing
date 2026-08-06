import { describe, expect, it } from 'vitest'
import { fixedClock, systemClock } from './clock'
import { newId } from './ids'

describe('ids & clock', () => {
  it('generates unique 21-character ids', () => {
    const first = newId()
    const second = newId()

    expect(first).not.toBe(second)
    expect(first).toHaveLength(21)
    expect(second).toHaveLength(21)
  })

  it('fixed clock returns fixed time', () => {
    const clock = fixedClock('2026-08-05T00:00:00.000Z')

    expect(clock.now()).toBe('2026-08-05T00:00:00.000Z')
  })

  it('system clock returns an ISO timestamp', () => {
    const now = systemClock.now()

    expect(new Date(now).toISOString()).toBe(now)
  })
})
