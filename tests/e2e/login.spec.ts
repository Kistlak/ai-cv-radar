import { test, expect } from '@playwright/test'

test('login page renders the magic-link form', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()

  const email = page.getByLabel(/email address/i)
  await expect(email).toBeVisible()
  await email.fill('test@example.com')

  await expect(page.getByRole('button', { name: /send magic link/i })).toBeEnabled()
})

test('submit button is disabled before entering an email', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /send magic link/i })).toBeDisabled()
})

test('back to home link returns to landing', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: /back to home/i }).click()
  await expect(page).toHaveURL(/\/$/)
})
