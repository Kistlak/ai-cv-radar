const originsEl = document.getElementById('origins')
const btn = document.getElementById('fillBtn')
const statusEl = document.getElementById('status')

chrome.storage.local.get('appOrigins').then(({ appOrigins }) => {
  if (!Array.isArray(appOrigins) || appOrigins.length === 0) return
  originsEl.innerHTML = ''
  for (const origin of appOrigins) {
    const code = document.createElement('code')
    code.textContent = origin
    originsEl.appendChild(code)
  }
})

function setStatus(text, tone) {
  statusEl.textContent = text
  statusEl.className = tone ? `status ${tone}` : 'status'
}

btn.addEventListener('click', async () => {
  btn.disabled = true
  setStatus('Filling form…', 'info')
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FILL_ACTIVE_TAB' })
    if (!response?.ok) throw new Error(response?.error || 'Failed to fill')
    setStatus('Done — review the fields before submitting.', 'ok')
    setTimeout(() => window.close(), 900)
  } catch (err) {
    setStatus(err.message || 'Something went wrong', 'err')
  } finally {
    btn.disabled = false
  }
})
