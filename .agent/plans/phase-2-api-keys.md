# Phase 2 — API Keys (BYOK)

**Status:** NOT STARTED
**Depends on:** Phase 1 complete and verified
**Goal:** Encrypt/decrypt user API keys, build settings page, verify round-trip.

## Steps

- [ ] 1. Write `src/lib/crypto.ts`
  - Algorithm: AES-256-GCM
  - Key source: `APP_ENCRYPTION_KEY` env var (base64, 32 bytes)
  - Storage format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
  - Exports: `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`
  - Never log plaintext or ciphertext

- [ ] 2. Write `src/app/api/keys/route.ts`
  - POST: accept `{ anthropic_key?, apify_token?, adzuna_app_id?, adzuna_app_key?, rapidapi_key? }`
    - Validate with Zod
    - Encrypt each non-null value
    - Upsert into `user_api_keys`
    - Return `{ success: true }`
  - GET: return which keys are SET (boolean flags only — never return values)
    ```json
    { "anthropic_key": true, "apify_token": false, ... }
    ```

- [ ] 3. Write `src/components/api-keys-form.tsx`
  - Masked inputs (type="password") for each key
  - Show "••••••••" placeholder if key is already set
  - Show "Not configured" if not set
  - "How to get this key" help link per provider:
    - Anthropic: console.anthropic.com/api-keys
    - Apify: console.apify.com/account/integrations
    - Adzuna: developer.adzuna.com
    - RapidAPI/JSearch: rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
  - Save button per key (or one "Save All" button)
  - react-hook-form + Zod resolver

- [ ] 4. Write `src/app/(app)/settings/page.tsx`
  - Import and render `ApiKeysForm`
  - On mount, call GET /api/keys to show which are set

## Verify
- Save an Anthropic key → DB row shows ciphertext (not plaintext)
- GET /api/keys shows `{ anthropic_key: true }`
- Decrypt the stored value server-side → matches original input
- Visiting settings page shows masked "••••••••" for saved keys
- Keys never appear in browser network tab responses
