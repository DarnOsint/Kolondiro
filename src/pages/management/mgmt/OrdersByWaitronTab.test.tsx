import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

// Mock supabase client to return controlled data
const mockData = [
  {
    quantity: 3,
    total_price: 300,
    destination: 'bar',
    created_at: new Date().toISOString(),
    return_accepted: false,
    orders: { profiles: { full_name: 'Alex' } },
    menu_items: { name: 'Beer', menu_categories: { destination: 'bar' } },
  },
  {
    // Should be excluded from totals because it was approved (return_accepted)
    quantity: 2,
    total_price: 200,
    destination: 'bar',
    created_at: new Date().toISOString(),
    return_accepted: true,
    orders: { profiles: { full_name: 'Alex' } },
    menu_items: { name: 'Whisky', menu_categories: { destination: 'bar' } },
  },
]

vi.mock('../../../lib/supabase', () => {
  const query = {
    select: () => query,
    gte: () => query,
    lte: () => Promise.resolve({ data: mockData }),
  }
  return { supabase: { from: () => query } }
})

import OrdersByWaitronTab from './OrdersByWaitronTab'

describe('OrdersByWaitronTab', () => {
  afterEach(() => {
    cleanup()
  })

  it('excludes return_accepted items from waitron totals', async () => {
    render(<OrdersByWaitronTab destinations={['bar']} title="Bar Waitron Orders" />)

    await waitFor(() => {
      expect(screen.queryByText(/Loading…/)).not.toBeInTheDocument()
    })

    // Row should show only the non-return_accepted item totals: qty 3, total ₦300
    expect(screen.getByText('Alex')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('₦300')).toBeInTheDocument()

    // Should NOT include the excluded item's amount (would have been 5 / ₦500)
    expect(screen.queryByText('5')).not.toBeInTheDocument()
    expect(screen.queryByText('₦500')).not.toBeInTheDocument()
  })
})
