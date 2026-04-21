import { test, expect } from '@playwright/test'

const PROTECTED_PATHS = ['/search', '/cv', '/settings', '/help']

for (const path of PROTECTED_PATHS) {
  test(`unauthenticated visit to ${path} redirects to /login`, async ({ page }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login/)
  })
}
