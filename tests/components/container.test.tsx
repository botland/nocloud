import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Container from '@/components/Container'

describe('Container', () => {
  it('renders children with layout classes', () => {
    render(
      <Container className="extra">
        <span>Inside</span>
      </Container>,
    )
    const el = screen.getByText('Inside').parentElement
    expect(el?.className).toContain('max-w-7xl')
    expect(el?.className).toContain('extra')
  })
})