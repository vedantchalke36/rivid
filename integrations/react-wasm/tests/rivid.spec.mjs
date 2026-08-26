import { expect, test } from '@playwright/test'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

test('rivid-wasm loads and passes all in-browser spec vectors', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'rivid-wasm × React' })).toBeVisible()

  // The self-test panel runs the reference vectors inside the real browser.
  await expect(page.getByText(/ALL \d+ CHECKS PASS/)).toBeVisible({ timeout: 15_000 })
})

test('single generation produces valid ULID with decodable timestamp', async ({ page }) => {
  await page.goto('/')
  await page.getByText(/ALL \d+ CHECKS PASS/).waitFor()

  const before = Date.now()
  await page.getByRole('button', { name: 'generate' }).first().click()
  const id = await page.locator('section:has-text("Single ULID") >> p >> nth=0').textContent()
  expect(id).toMatch(ULID_RE)

  const raw = await page.locator('section:has-text("Single ULID")').getByText(/time component →/).textContent()
  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/)
  expect(isoMatch, 'ISO timestamp rendered next to the ULID').toBeTruthy()
  const decodedMs = Date.parse(isoMatch[0])
  // Batch-free single IDs read the live clock at generation time.
  expect(Math.abs(decodedMs - Math.max(before, Date.now() - 60_000))).toBeLessThan(120_000)
})

test('monotonic stream strictly increases per click', async ({ page }) => {
  await page.goto('/')
  await page.getByText(/ALL \d+ CHECKS PASS/).waitFor()

  const monoSection = page.locator('section', { hasText: 'Monotonic stream' })
  const btn = monoSection.getByRole('button', { name: 'next' })
  await btn.click()
  await btn.click()
  await btn.click()
  const ids = await monoSection.locator('p').allTextContents()
  const ulids = ids.filter((t) => ULID_RE.test(t.trim()))
  expect(ulids.length).toBe(3)
  expect(ulids[0] < ulids[1]).toBe(true)
  expect(ulids[1] < ulids[2]).toBe(true)
})

test('bulk 10k reports throughput and validator reacts to input', async ({ page }) => {
  await page.goto('/')
  await page.getByText(/ALL \d+ CHECKS PASS/).waitFor()

  await page.getByRole('button', { name: 'run' }).click()
  await expect(page.getByText(/ms total/)).toBeVisible()
  await expect(page.getByText(/ids\/sec/)).toBeVisible()

  const input = page.getByPlaceholder('paste a ULID')
  await input.fill('01ARZ3NDEKTSV4RRFFQ69G5FA')
  await expect(page.getByText('❌ invalid')).toBeVisible()
  await input.fill('01ARZ3NDEKTSV4RRFFQ69G5FAV')
  await expect(page.getByText('✅ valid ULID')).toBeVisible()
})
