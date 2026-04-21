import { test, expect } from '@playwright/test'

test('landing page shows hero and primary CTAs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /actually match/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /get started/i })).toBeVisible()
})

test('features section lists source highlights', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('AI-Ranked Matches')).toBeVisible()
  await expect(page.getByText('6 Sources, One Search')).toBeVisible()
  await expect(page.getByText('Bring Your Own Keys')).toBeVisible()
})

test('get started CTA routes to /login', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /get started/i }).click()
  await expect(page).toHaveURL(/\/login$/)
})
