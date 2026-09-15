import { test, expect } from '@playwright/test'
import { loginAsManager } from './helpers'

test.describe('Accounting', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_MANAGER_PASSWORD) { test.skip(); return }
    await loginAsManager(page)
    await page.goto('/accounting')
  })

  test('accounting loads with date range and tabs', async ({ page }) => {
    await expect(page.getByText(/Today|This Week|This Month/i)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/Overview|Orders|Staff|Till/i)).toBeVisible()
  })

  test('overview tab shows revenue summary', async ({ page }) => {
    await expect(page.getByText(/Gross Revenue|Total Revenue/i)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/₦/)).toBeVisible()
  })

  test('POS Recon tab loads', async ({ page }) => {
    const posTab = page.getByRole('button', { name: /POS Recon/i })
    await expect(posTab).toBeVisible({ timeout: 6_000 })
    await posTab.click()
    // Should show period label and either machine cards or empty state
    await expect(page.getByText(/Today|Period|No attendance/i)).toBeVisible({ timeout: 8_000 })
  })

  test('staff tab shows waitron performance', async ({ page }) => {
    await page.getByRole('button', { name: /^Staff$/i }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Error')
  })

  test('debtors tab loads', async ({ page }) => {
    await page.getByRole('button', { name: /Debtors/i }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Error')
  })

  test('ledger tab loads and has export', async ({ page }) => {
    await page.getByRole('button', { name: /Ledger/i }).click()
    await expect(page.getByText(/Export|PDF|General Ledger/i)).toBeVisible({ timeout: 6_000 })
  })

  test('switching date range refreshes data', async ({ page }) => {
    await page.getByRole('button', { name: /This Week/i }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/This Week/i)).toBeVisible()
    // Revenue figure should update (may be same value — just check no error)
    await expect(page.locator('body')).not.toContainText('Error')
  })
})
