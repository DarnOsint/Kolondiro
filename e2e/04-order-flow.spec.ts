import { test, expect } from '@playwright/test'
import { loginAsManager, loginWithPin, TEST_WAITRON_PIN } from './helpers'

// This test runs a full order → payment cycle on a test table.
// Requires: E2E_MANAGER_PASSWORD + E2E_WAITRON_PIN + a test table available.
// Set E2E_TEST_TABLE to the table name (e.g. "Table 21") to target a specific table.

const TEST_TABLE = process.env.E2E_TEST_TABLE || ''

test.describe('Order Flow — End to End', () => {

  test('cash sale: place and pay immediately', async ({ page }) => {
    if (!process.env.E2E_WAITRON_PIN || !process.env.E2E_MANAGER_PASSWORD) {
      test.skip(); return
    }
    await loginWithPin(page, TEST_WAITRON_PIN)

    // Click Cash Sale
    await page.getByRole('button', { name: /Cash Sale/i }).click()
    await expect(page.getByText(/Counter|Cash Sale/i)).toBeVisible({ timeout: 6_000 })

    // Add first visible item
    const firstItem = page.locator('[class*="menu-item"], button').filter({ hasText: /₦/ }).first()
    if (await firstItem.isVisible()) {
      await firstItem.click()
    } else {
      // Fallback: click any item in the menu panel
      await page.locator('button').filter({ hasText: /Add/ }).first().click()
    }

    // Confirm order
    const confirmBtn = page.getByRole('button', { name: /Confirm|Place Order/i })
    await expect(confirmBtn).toBeVisible({ timeout: 4_000 })
    await confirmBtn.click()

    // Payment modal should appear
    await expect(page.getByText(/Cash|Transfer|Payment/i)).toBeVisible({ timeout: 6_000 })

    // Select Cash and pay
    await page.getByRole('button', { name: /^Cash$/i }).click()
    const payBtn = page.getByRole('button', { name: /Pay|Process/i })
    await expect(payBtn).toBeEnabled({ timeout: 3_000 })
    await payBtn.click()

    // Success state
    await expect(page.getByText(/paid|complete|receipt/i)).toBeVisible({ timeout: 8_000 })
  })

  test('takeaway: requires customer name', async ({ page }) => {
    if (!process.env.E2E_WAITRON_PIN) { test.skip(); return }
    await loginWithPin(page, TEST_WAITRON_PIN)

    await page.getByRole('button', { name: /Takeaway/i }).click()
    await expect(page.getByPlaceholder(/customer.*name|name/i)).toBeVisible({ timeout: 6_000 })

    // Try to proceed without name
    const confirmBtn = page.getByRole('button', { name: /Confirm|Next/i })
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click()
      // Should warn about missing name
      const warned = await page.getByText(/name.*required|enter.*name/i).isVisible()
        .catch(() => false)
      // Either shows warning or doesn't proceed
      expect(warned || await page.getByPlaceholder(/customer.*name|name/i).isVisible()).toBeTruthy()
    }
  })

  test('void requires manager PIN', async ({ page }) => {
    if (!process.env.E2E_WAITRON_PIN) { test.skip(); return }
    await loginWithPin(page, TEST_WAITRON_PIN)

    // Navigate to an occupied table if TEST_TABLE is set
    if (TEST_TABLE) {
      const tableBtn = page.getByRole('button', { name: TEST_TABLE })
      if (await tableBtn.isVisible()) {
        await tableBtn.click()
        // Look for delete/void button on an existing item
        const voidBtn = page.getByRole('button', { name: /void|remove|×/i }).first()
        if (await voidBtn.isVisible({ timeout: 3_000 })) {
          await voidBtn.click()
          // Should ask for manager PIN
          await expect(page.getByText(/manager.*pin|approve.*void|PIN/i)).toBeVisible({ timeout: 5_000 })
        }
      }
    } else {
      test.skip()
    }
  })

})
