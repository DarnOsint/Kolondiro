import { test, expect } from '@playwright/test'
import { loginWithPin } from './helpers'

test.describe('Supervisor Dashboard', () => {
  test('supervisor PIN logs in to supervisor dashboard', async ({ page }) => {
    const pin = process.env.E2E_SUPERVISOR_PIN
    if (!pin) { test.skip(); return }
    await loginWithPin(page, pin)
    await expect(page).toHaveURL(/\/supervisor/, { timeout: 8_000 })
    await expect(page.getByText(/Floor|Staff|Calls|Voids/i)).toBeVisible()
  })

  test('supervisor dashboard shows KPI strip', async ({ page }) => {
    const pin = process.env.E2E_SUPERVISOR_PIN
    if (!pin) { test.skip(); return }
    await loginWithPin(page, pin)
    await expect(page.getByText(/Open Orders|On Shift|Pending/i)).toBeVisible({ timeout: 6_000 })
  })

  test('zone filter pills are visible on floor tab', async ({ page }) => {
    const pin = process.env.E2E_SUPERVISOR_PIN
    if (!pin) { test.skip(); return }
    await loginWithPin(page, pin)
    for (const zone of ['All', 'Outdoor', 'Indoor', 'VIP Lounge', 'The Nook']) {
      await expect(page.getByRole('button', { name: zone })).toBeVisible({ timeout: 6_000 })
    }
  })

  test('supervisor cannot navigate to POS or Management', async ({ page }) => {
    const pin = process.env.E2E_SUPERVISOR_PIN
    if (!pin) { test.skip(); return }
    await loginWithPin(page, pin)
    // No sidebar should be visible
    await expect(page.getByText(/Back Office|Accounting/i)).not.toBeVisible()
  })
})
