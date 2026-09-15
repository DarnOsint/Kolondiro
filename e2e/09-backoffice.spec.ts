import { test, expect } from '@playwright/test'
import { loginAsManager } from './helpers'

test.describe('Back Office', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_MANAGER_PASSWORD) { test.skip(); return }
    await loginAsManager(page)
    await page.goto('/backoffice')
  })

  test('backoffice shows all section tiles', async ({ page }) => {
    const sections = ['Staff Management', 'Menu Management', 'Zone Pricing',
      'Table Configuration', 'POS Machines', 'Drink Inventory', 'Suppliers']
    for (const s of sections) {
      await expect(page.getByText(s)).toBeVisible({ timeout: 8_000 })
    }
  })

  test('POS Machines section loads and shows add form', async ({ page }) => {
    await page.getByText('POS Machines').click()
    await expect(page.getByPlaceholder(/POS-1|Counter|Terminal/i)).toBeVisible({ timeout: 6_000 })
  })

  test('Table Config shows zone settings with hire fee fields', async ({ page }) => {
    await page.getByText('Table Configuration').click()
    await expect(page.getByText(/Zone Settings|Hire Fee/i)).toBeVisible({ timeout: 6_000 })
  })

  test('menu management loads item list', async ({ page }) => {
    await page.getByText('Menu Management').click()
    await expect(page.getByPlaceholder(/search/i)).toBeVisible({ timeout: 6_000 })
  })

  test('zone pricing shows zone tabs', async ({ page }) => {
    await page.getByText('Zone Pricing').click()
    await expect(page.getByText(/Outdoor|Indoor|VIP|Nook/i)).toBeVisible({ timeout: 6_000 })
  })

  test('staff management loads staff list', async ({ page }) => {
    await page.getByText('Staff Management').click()
    await expect(page.getByPlaceholder(/search/i)).toBeVisible({ timeout: 6_000 })
  })
})
