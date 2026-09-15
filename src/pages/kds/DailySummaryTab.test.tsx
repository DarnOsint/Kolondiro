// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

const mockData = [
  {
    quantity: 2,
    status: 'delivered',
    return_accepted: false,
    destination: 'bar',
    menu_items: { name: 'Beer', menu_categories: { destination: 'bar' } },
    orders: {
      created_at: new Date().toISOString(),
      order_type: 'table',
      profiles: { full_name: 'Waitron A' },
      tables: null,
    },
  },
  {
    // Should be excluded from summary because return_accepted
    quantity: 5,
    status: 'delivered',
    return_accepted: true,
    destination: 'bar',
    menu_items: { name: 'Whisky', menu_categories: { destination: 'bar' } },
    orders: {
      created_at: new Date().toISOString(),
      order_type: 'table',
      profiles: { full_name: 'Waitron A' },
      tables: null,
    },
  },
]

vi.mock('../../lib/supabase', () => {
  const query = {
    select: () => query,
    gte: () => query,
    // DailySummaryTab uses `.lt` for the end of the day window.
    // Keep `.lte` too in case other call sites still use it.
    lt: () => Promise.resolve({ data: mockData }),
    lte: () => Promise.resolve({ data: mockData }),
  }
  return { supabase: { from: () => query } }
})

import DailySummaryTab from './DailySummaryTab'

describe('DailySummaryTab', () => {
  afterEach(() => cleanup())

  it('excludes return_accepted items from summary totals', async () => {
    render(<DailySummaryTab destination="bar" icon={null} color="text-amber-500" />)

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument()
    })

    // Totals should reflect only the non-return_accepted item (quantity 2)
    const header = screen.getByText(/Total drinks served/i).parentElement
    expect(header).toHaveTextContent('2')
    expect(screen.getAllByText('Beer').length).toBe(1)
    expect(screen.queryByText('Whisky')).not.toBeInTheDocument()
    expect(screen.queryByText('5')).not.toBeInTheDocument()
  })
})
