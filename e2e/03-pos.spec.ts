import { test, expect } from '@playwright/test'
import { loginWithPin, TEST_WAITRON_PIN } from './helpers'

test.describe('POS — Waitron Flow', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_WAITRON_PIN) { test.skip(); return }
    await loginWithPin(page, TEST_WAITRON_PIN)
  })

  test('POS loads with table grid after PIN login', async ({ page }) => {
    await expect(page.getByText(/Tables|My Orders|My Shift/i)).toBeVisible({ timeout: 8_000 })
  })

  test('unassigned waitron sees locked/empty state', async ({ page }) => {
    // If waitron has no tables assigned they see the locked state
    const locked = await page.getByText(/not clocked in|no tables assigned|contact.*manager/i)
      .isVisible().catch(() => false)
    const hasGrid = await page.locator('button').filter({ hasText: /^\d+$/ }).count()
    expect(locked || hasGrid > 0).toBeTruthy()
  })

  test('My Shift tab shows shift stats', async ({ page }) => {
    await page.getByRole('button', { name: /My Shift/i }).click()
    // Should show revenue and order count
    await expect(page.getByText(/₦|Revenue|Orders|Sales/i)).toBeVisible({ timeout: 6_000 })
  })

  test('My Orders tab shows today order history', async ({ page }) => {
    await page.getByRole('button', { name: /My Orders/i }).click()
    await page.waitForLoadState('networkidle')
    // Either shows orders or empty state
    await expect(page.locator('body')).not.toContainText('Error')
  })

  test('help tooltip is accessible', async ({ page }) => {
    const helpBtn = page.locator('[aria-label*="help"], button').filter({ hasText: /\?/i }).first()
    if (await helpBtn.isVisible()) {
      await helpBtn.click()
      await expect(page.getByText(/Zone Pricing|Clock In|Placing an Order/i)).toBeVisible()
    }
  })

  test('cash sale button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Cash Sale/i })).toBeVisible({ timeout: 6_000 })
  })

  test('takeaway button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Takeaway/i })).toBeVisible({ timeout: 6_000 })
  })
})
