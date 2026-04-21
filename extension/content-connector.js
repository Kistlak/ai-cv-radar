// Runs on the CV Radar web app origin. Its job is:
// 1. Mark the page so the app can detect the extension is installed.
// 2. Forward Auto Apply requests from the page (window.postMessage) to the
//    background service worker.
// 3. Remember which origin is "the app", so background can fetch profile data.

const MARKER_ATTR = 'data-cv-radar-extension'
const VERSION = chrome.runtime.getManifest().version

function mark() {
  if (document.documentElement) {
    document.documentElement.setAttribute(MARKER_ATTR, VERSION)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mark, { once: true })
} else {
  mark()
}
mark()

// Remember this origin as a trusted "app origin" so the background SW knows
// where to fetch profile data from.
chrome.runtime
  .sendMessage({ type: 'REGISTER_APP_ORIGIN', origin: window.location.origin })
  .catch(() => {})

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.source !== 'cv-radar') return
  if (data.type !== 'AUTO_APPLY_REQUEST') return

  chrome.runtime
    .sendMessage({
      type: 'AUTO_APPLY',
      appOrigin: window.location.origin,
      payload: data.payload,
    })
    .catch((err) => {
      console.warn('[cv-radar] failed to forward auto-apply request', err)
    })
})
