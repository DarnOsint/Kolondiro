import { test, expect } from '@playwright/test'
import { loginAsManager } from './helpers'

test.describe('Executive Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_MANAGER_PASSWORD) { test.skip(); return }
    await loginAsManager(page)
    await page.goto('/executive')
  })

  test('executive dashboard shows all 6 KPI cards', async ({ page }) => {
    await expect(page.getByText(/Today.*Revenue|Revenue Today/i)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/Open Orders/i)).toBeVisible()
    await expect(page.getByText(/Occupied Tables/i)).toBeVisible()
    await expect(page.getByText(/Occupied Rooms/i)).toBeVisible()
    await expect(page.getByText(/Staff On Duty/i)).toBeVisible()
    await expect(page.getByText(/Low Stock/i)).toBeVisible()
  })

  test('revenue chart is visible', async ({ page }) => {
    await expect(page.getByText(/7.Day|Revenue.*Last|Last.*Days/i)).toBeVisible({ timeout: 6_000 })
  })

  test('recent orders section loads', async ({ page }) => {
    await expect(page.getByText(/Recent Orders|Today.*Orders/i)).toBeVisible({ timeout: 6_000 })
  })

  test('bank transfer details section visible', async ({ page }) => {
    await expect(page.getByText(/Bank Transfer/i)).toBeVisible({ timeout: 6_000 })
  })

  test('quick action tiles navigate correctly', async ({ page }) => {
    const accountingTile = page.getByRole('button', { name: /Accounting/i })
    if (await accountingTile.isVisible()) {
      await accountingTile.click()
      await expect(page).toHaveURL(/\/accounting/, { timeout: 6_000 })
    }
  })
})
