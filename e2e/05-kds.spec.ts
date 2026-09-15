import { test, expect } from '@playwright/test'
import { loginWithPin } from './helpers'

const KDS_PINS: Record<string, string> = {
  kitchen: process.env.E2E_KITCHEN_PIN || '',
  bar: process.env.E2E_BAR_PIN || '',
  griller: process.env.E2E_GRILLER_PIN || '',
}

test.describe('KDS — Kitchen Display', () => {
  test('kitchen KDS loads after PIN login', async ({ page }) => {
    if (!KDS_PINS.kitchen) { test.skip(); return }
    await loginWithPin(page, KDS_PINS.kitchen)
    await expect(page).toHaveURL(/\/kds\/kitchen/, { timeout: 8_000 })
    await expect(page.getByText(/Kitchen|Orders|Stock/i)).toBeVisible()
  })

  test('kitchen KDS shows Orders and Stock Register tabs', async ({ page }) => {
    if (!KDS_PINS.kitchen) { test.skip(); return }
    await loginWithPin(page, KDS_PINS.kitchen)
    await expect(page.getByRole('button', { name: /Orders/i })).toBeVisible({ timeout: 6_000 })
    await expect(page.getByRole('button', { name: /Stock/i })).toBeVisible()
  })

  test('bar KDS loads after PIN login', async ({ page }) => {
    if (!KDS_PINS.bar) { test.skip(); return }
    await loginWithPin(page, KDS_PINS.bar)
    await expect(page).toHaveURL(/\/kds\/bar/, { timeout: 8_000 })
    await expect(page.getByText(/Bar|Drinks|Orders/i)).toBeVisible()
  })

  test('griller KDS loads after PIN login', async ({ page }) => {
    if (!KDS_PINS.griller) { test.skip(); return }
    await loginWithPin(page, KDS_PINS.griller)
    await expect(page).toHaveURL(/\/kds\/grill/, { timeout: 8_000 })
    await expect(page.getByText(/Grill|Tickets|Orders/i)).toBeVisible()
  })
})
