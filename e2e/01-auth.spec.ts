import { test, expect } from '@playwright/test'
import { loginAsManager, loginWithPin, TEST_WAITRON_PIN } from './helpers'

test.describe('Authentication', () => {

  test('login page loads and shows PIN pad by default', async ({ page }) => {
    await page.goto('/login')
    // PIN pad should be visible (digit buttons 0-9)
    for (const d of ['1','2','3','4','5','6','7','8','9','0']) {
      await expect(page.getByRole('button', { name: d }).first()).toBeVisible()
    }
    await expect(page.getByText(/Kolondiro/i)).toBeVisible()
  })

  test('wrong PIN shows error and does not log in', async ({ page }) => {
    await page.goto('/login')
    // Enter 4 wrong digits
    for (const d of ['9','9','9','9']) {
      await page.getByRole('button', { name: d }).first().click()
    }
    await expect(page.getByText(/incorrect|not found|invalid/i)).toBeVisible({ timeout: 6_000 })
    // Should still be on login
    await expect(page).toHaveURL(/\/login/)
  })

  test('5 wrong PINs triggers lockout', async ({ page }) => {
    await page.goto('/login')
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const d of ['8','8','8','8']) {
        await page.getByRole('button', { name: d }).first().click()
      }
      // Wait for error to show and clear
      await page.waitForTimeout(500)
    }
    // After 5 attempts lockout message should appear
    await expect(page.getByText(/try again in|locked/i)).toBeVisible({ timeout: 6_000 })
  })

  test('manager can login with email and password', async ({ page }) => {
    // Only runs if E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are set
    if (!process.env.E2E_MANAGER_PASSWORD) {
      test.skip()
      return
    }
    await loginAsManager(page)
    await expect(page.getByText(/management|executive/i)).toBeVisible()
  })

  test('unauthenticated user redirected from protected route', async ({ page }) => {
    await page.goto('/management')
    await expect(page).toHaveURL(/\/login/, { timeout: 6_000 })
  })

  test('unauthenticated user redirected from POS', async ({ page }) => {
    await page.goto('/pos')
    await expect(page).toHaveURL(/\/login/, { timeout: 6_000 })
  })

})
