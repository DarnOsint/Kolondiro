import { test, expect } from '@playwright/test'
import { loginAsManager, goToManagementTab } from './helpers'

test.describe('Management — Shifts', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_MANAGER_PASSWORD) { test.skip(); return }
    await loginAsManager(page)
  })

  test('management overview loads with KPI cards', async ({ page }) => {
    await page.goto('/management')
    await expect(page.getByText(/Open Orders/i)).toBeVisible()
    await expect(page.getByText(/Staff On Shift/i)).toBeVisible()
    await expect(page.getByText(/Revenue Today/i)).toBeVisible()
    await expect(page.getByText(/Occupied Tables/i)).toBeVisible()
  })

  test('shifts tab shows staff list', async ({ page }) => {
    await goToManagementTab(page, 'Shifts')
    // Should show All Staff tab with at least one staff member
    await expect(page.getByText(/All Staff|Clock In/i)).toBeVisible({ timeout: 8_000 })
  })

  test('tables tab shows zone assignment interface', async ({ page }) => {
    await goToManagementTab(page, 'Tables')
    await expect(page.getByText(/Outdoor|Indoor|VIP|Nook/i)).toBeVisible({ timeout: 8_000 })
  })

  test('orders tab loads open orders or empty state', async ({ page }) => {
    await goToManagementTab(page, 'Orders')
    // Either shows orders or the empty state message
    const hasOrders = await page.getByText(/No open orders/i).isVisible()
      .catch(() => false)
    const hasOrderCards = await page.locator('[class*="rounded-2xl"]').count()
    expect(hasOrders || hasOrderCards > 0).toBeTruthy()
  })

  test('activity log tab loads and shows filters', async ({ page }) => {
    await goToManagementTab(page, 'Activity')
    await expect(page.getByPlaceholder(/search/i)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/All|Login|Sales|Voids|Shifts/i)).toBeVisible()
  })

  test('voids tab loads', async ({ page }) => {
    await goToManagementTab(page, 'Voids')
    // Either shows voids or empty state
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Error')
  })
})
