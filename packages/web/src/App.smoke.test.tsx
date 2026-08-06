import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('App smoke', () => {
  it('mounts the workbench and tree launcher', () => {
    render(<App api={{ listTrees: vi.fn(() => new Promise(() => {})) } as never} />)
    expect(screen.getByTestId('workbench')).toBeInTheDocument()
    expect(screen.getByLabelText('new-tree-title')).toBeInTheDocument()
  })
})
