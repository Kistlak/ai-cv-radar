chrome.storage.local.get('appOrigins').then(({ appOrigins }) => {
  const el = document.getElementById('origins')
  if (!el) return
  if (!Array.isArray(appOrigins) || appOrigins.length === 0) return
  el.innerHTML = ''
  for (const origin of appOrigins) {
    const code = document.createElement('code')
    code.textContent = origin
    el.appendChild(code)
  }
})
