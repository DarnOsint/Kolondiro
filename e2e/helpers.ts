import { Page, expect } from '@playwright/test'

export const TEST_MANAGER = {
  email: process.env.E2E_MANAGER_EMAIL || 'manager@kolondiro.com',
  password: process.env.E2E_MANAGER_PASSWORD || '',
}
export const TEST_WAITRON_PIN = process.env.E2E_WAITRON_PIN || '1234'
export const TEST_WAITRON_NAME = process.env.E2E_WAITRON_NAME || 'Test Waitron'

/** Login as manager via email+password */
export async function loginAsManager(page: Page) {
  await page.goto('/login')
  // Switch to email mode
  const emailLink = page.getByRole('button', { name: /use email/i })
  if (await emailLink.isVisible()) await emailLink.click()
  await page.getByPlaceholder(/email/i).fill(TEST_MANAGER.email)
  await page.getByPlaceholder(/password/i).fill(TEST_MANAGER.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/management|\/executive|\/dashboard/, { timeout: 10_000 })
}

/** Login as waitron via PIN */
export async function loginWithPin(page: Page, pin: string) {
  await page.goto('/login')
  // PIN is the default — tap each digit
  for (const digit of pin) {
    await page.getByRole('button', { name: digit }).first().click()
  }
  await expect(page).toHaveURL(/\/pos/, { timeout: 10_000 })
}

/** Wait for toast or success indicator */
export async function waitForSuccess(page: Page, text?: string) {
  if (text) {
    await expect(page.getByText(text)).toBeVisible({ timeout: 8_000 })
  } else {
    await page.waitForTimeout(1_000)
  }
}

/** Navigate to a specific management tab */
export async function goToManagementTab(page: Page, tabName: string) {
  await page.goto('/management')
  await page.getByRole('button', { name: new RegExp(tabName, 'i') }).click()
  await page.waitForLoadState('networkidle')
}
