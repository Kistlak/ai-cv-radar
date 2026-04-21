// Service worker. Orchestrates Auto Apply:
// 1. Receives AUTO_APPLY from content-connector (user clicked Start in the app).
// 2. Fetches the canonical profile from the app's /api/me/application-profile
//    using the user's existing cookie session.
// 3. Opens the applyUrl in a new tab.
// 4. When that tab finishes loading, injects content-filler.js + ATS modules.
// 5. Hands the profile + job context to the filler via tab message.

const PENDING_KEY = 'pendingFills'
const APP_ORIGINS_KEY = 'appOrigins'
const EXPIRY_MS = 10 * 60 * 1000

async function getAppOrigins() {
  const { [APP_ORIGINS_KEY]: origins } = await chrome.storage.local.get(APP_ORIGINS_KEY)
  return Array.isArray(origins) ? origins : []
}

async function rememberAppOrigin(origin) {
  const existing = await getAppOrigins()
  if (existing.includes(origin)) return
  await chrome.storage.local.set({ [APP_ORIGINS_KEY]: [...existing, origin] })
}

async function getPendingFills() {
  const { [PENDING_KEY]: map } = await chrome.storage.session.get(PENDING_KEY)
  return map && typeof map === 'object' ? map : {}
}

async function setPendingFill(tabId, data) {
  const map = await getPendingFills()
  map[tabId] = data
  await chrome.storage.session.set({ [PENDING_KEY]: map })
}

async function consumePendingFill(tabId) {
  const map = await getPendingFills()
  const entry = map[tabId]
  if (!entry) return null
  delete map[tabId]
  await chrome.storage.session.set({ [PENDING_KEY]: map })
  if (entry.expiresAt && entry.expiresAt < Date.now()) return null
  return entry
}

async function peekPendingFill(tabId) {
  const map = await getPendingFills()
  const entry = map[tabId]
  if (!entry) return null
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    delete map[tabId]
    await chrome.storage.session.set({ [PENDING_KEY]: map })
    return null
  }
  return entry
}

async function fetchProfile(appOrigin) {
  const res = await fetch(`${appOrigin}/api/me/application-profile`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Profile fetch failed (${res.status})`)
  }
  const body = await res.json()
  if (!body.profile) throw new Error('No profile returned')
  return body.profile
}

async function notifyAppTab(appOrigin, status, message) {
  const tabs = await chrome.tabs.query({ url: `${appOrigin}/*` })
  for (const t of tabs) {
    if (t.id == null) continue
    chrome.tabs
      .sendMessage(t.id, { type: 'AUTO_APPLY_STATUS', status, message })
      .catch(() => {})
  }
}

async function handleAutoApply({ appOrigin, payload }) {
  if (!appOrigin || !payload?.applyUrl) {
    throw new Error('Missing applyUrl or appOrigin')
  }
  await rememberAppOrigin(appOrigin)

  const profile = await fetchProfile(appOrigin)

  const tab = await chrome.tabs.create({ url: payload.applyUrl, active: true })
  if (tab.id == null) throw new Error('Failed to open tab')

  await setPendingFill(tab.id, {
    profile,
    job: {
      jobId: payload.jobId,
      jobTitle: payload.jobTitle,
      company: payload.company,
      applyUrl: payload.applyUrl,
    },
    appOrigin,
    expiresAt: Date.now() + EXPIRY_MS,
  })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'REGISTER_APP_ORIGIN' && typeof msg.origin === 'string') {
    rememberAppOrigin(msg.origin).catch(() => {})
    return
  }

  if (msg.type === 'AUTO_APPLY') {
    handleAutoApply(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[cv-radar] AUTO_APPLY failed', err)
        sendResponse({ ok: false, error: String(err?.message || err) })
      })
    return true // async response
  }

  if (msg.type === 'REQUEST_PENDING_FILL') {
    const tabId = sender.tab?.id
    if (tabId == null) {
      sendResponse({ pending: null })
      return
    }
    // For manual fills the entry is shared across all frames of the tab, so
    // peek instead of consuming; it expires naturally after EXPIRY_MS.
    peekPendingFill(tabId)
      .then(async (pending) => {
        if (pending && !pending.job?.manual) await consumePendingFill(tabId)
        sendResponse({ pending })
      })
      .catch(() => sendResponse({ pending: null }))
    return true
  }

  if (msg.type === 'FILL_ACTIVE_TAB') {
    handleFillActiveTab()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[cv-radar] FILL_ACTIVE_TAB failed', err)
        sendResponse({ ok: false, error: String(err?.message || err) })
      })
    return true
  }

})

async function handleFillActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab')
  if (!tab.url || /^(chrome|edge|brave|about|chrome-extension):/i.test(tab.url)) {
    throw new Error('Cannot fill on this page')
  }

  const origins = await getAppOrigins()
  if (origins.length === 0) {
    throw new Error('Open CV Radar and sign in first, then try again')
  }

  let profile = null
  let lastError = null
  for (const origin of origins) {
    try {
      profile = await fetchProfile(origin)
      break
    } catch (err) {
      lastError = err
    }
  }
  if (!profile) {
    throw new Error(
      lastError?.message
        ? `Couldn't load your profile (${lastError.message}). Make sure you're signed into CV Radar.`
        : "Couldn't load your profile. Sign into CV Radar and try again."
    )
  }

  await setPendingFill(tab.id, {
    profile,
    job: { manual: true },
    appOrigin: origins[0],
    expiresAt: Date.now() + EXPIRY_MS,
  })

  // Reset the filler's single-run guard so repeat clicks work after the user
  // navigates through extra steps to reveal the form. allFrames: true so the
  // filler also runs inside embedded ATS iframes (Greenhouse/Lever embedded
  // on company career pages).
  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      delete window.__cvRadarFillerRan
    },
  })

  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ['content-filler.js'],
  })
}

// When a tab finishes loading, check if it has a pending fill and inject the
// filler content script.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  const map = await getPendingFills()
  const entry = map[tabId]
  if (!entry) return
  if (!tab.url || tab.url.startsWith('chrome://')) return

  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      files: ['content-filler.js'],
    })
    .catch((err) => console.warn('[cv-radar] failed to inject filler', err))
})
