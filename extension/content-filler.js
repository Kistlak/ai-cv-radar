// Injected into the job application tab after it loads.
// Requests the pending profile from background, detects the ATS, fills the
// form, and shows a floating badge. Never submits.

(function run() {
  if (window.__cvRadarFillerRan) return
  window.__cvRadarFillerRan = true

  chrome.runtime.sendMessage({ type: 'REQUEST_PENDING_FILL' }, (response) => {
    if (!response?.pending) return
    const { profile, job } = response.pending
    void autoApply(profile, job)
  })

  async function autoApply(profile, job) {
    const ats = detectAts(window.location.hostname)
    const filled = new Set()

    const tryFill = () => {
      const results = ats
        ? FILLERS[ats](profile, filled)
        : heuristicFill(profile, filled)
      return results
    }

    let totalFilled = tryFill().length

    // SPAs render forms after initial load — retry for a few seconds.
    const deadline = Date.now() + 6000
    await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const added = tryFill()
        if (added.length > 0) totalFilled += added.length
        if (Date.now() > deadline) {
          observer.disconnect()
          resolve()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      setTimeout(() => {
        observer.disconnect()
        resolve()
      }, 6000)
    })

    showBadge({ filled: totalFilled, ats, job, filledEls: filled })
  }

  // ---------- ATS detection ----------

  function detectAts(host) {
    if (/(^|\.)greenhouse\.io$/.test(host) || /boards\.greenhouse\.io$/.test(host)) return 'greenhouse'
    if (/(^|\.)lever\.co$/.test(host)) return 'lever'
    if (/(^|\.)ashbyhq\.com$/.test(host)) return 'ashby'
    if (/(^|\.)workable\.com$/.test(host) || /apply\.workable\.com$/.test(host)) return 'workable'
    return null
  }

  // ---------- Value setters (React-friendly) ----------

  function setInputValue(el, value) {
    if (el == null || value == null || value === '') return false
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (el.type === 'checkbox' || el.type === 'radio') return false
      if (el.value === String(value)) return false
      const proto = tag === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) { setter.call(el, String(value)) } else { el.value = String(value) }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('blur', { bubbles: true }))
      return true
    }
    if (tag === 'SELECT') {
      const target = String(value).toLowerCase()
      const match = Array.from(el.options).find(
        (o) =>
          o.value.toLowerCase() === target || o.textContent.trim().toLowerCase() === target
      )
      if (!match) return false
      el.value = match.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    return false
  }

  function fillBySelector(root, selector, value, filled) {
    const el = root.querySelector(selector)
    if (!el || filled.has(el)) return false
    if (setInputValue(el, value)) {
      filled.add(el)
      highlight(el)
      return true
    }
    return false
  }

  function highlight(el) {
    try {
      const prev = el.style.outline
      el.style.outline = '2px solid rgba(139, 92, 246, 0.6)'
      el.style.outlineOffset = '2px'
      setTimeout(() => {
        el.style.outline = prev
      }, 2500)
    } catch {}
  }

  // ---------- ATS-specific fillers ----------

  const FILLERS = {
    greenhouse(profile, filled) {
      const added = []
      const root = document
      const pairs = [
        ['#first_name', profile.firstName],
        ['#last_name', profile.lastName],
        ['#email', profile.email],
        ['#phone', profile.phone],
        ['input[name="job_application[first_name]"]', profile.firstName],
        ['input[name="job_application[last_name]"]', profile.lastName],
        ['input[name="job_application[email]"]', profile.email],
        ['input[name="job_application[phone]"]', profile.phone],
      ]
      for (const [sel, val] of pairs) {
        if (fillBySelector(root, sel, val, filled)) added.push(sel)
      }
      return added
    },

    lever(profile, filled) {
      const added = []
      const pairs = [
        ['input[name="name"]', profile.fullName],
        ['input[name="email"]', profile.email],
        ['input[name="phone"]', profile.phone],
        ['input[name="org"]', currentCompany(profile)],
        ['input[name="urls[LinkedIn]"]', profile.linkedin],
        ['input[name="urls[Portfolio]"]', profile.website],
      ]
      for (const [sel, val] of pairs) {
        if (fillBySelector(document, sel, val, filled)) added.push(sel)
      }
      return added
    },

    ashby(profile, filled) {
      const added = []
      const pairs = [
        ['input[name="_systemfield_name"]', profile.fullName],
        ['input[name="_systemfield_email"]', profile.email],
        ['input[name="_systemfield_phone"]', profile.phone],
        ['input[name="_systemfield_linkedin"]', profile.linkedin],
        ['input[name="_systemfield_website"]', profile.website],
      ]
      for (const [sel, val] of pairs) {
        if (fillBySelector(document, sel, val, filled)) added.push(sel)
      }
      // Ashby labels are stable — fall back to heuristic for the rest.
      added.push(...heuristicFill(profile, filled))
      return added
    },

    workable(profile, filled) {
      const added = []
      const pairs = [
        ['input[name="firstname"]', profile.firstName],
        ['input[name="lastname"]', profile.lastName],
        ['input[name="email"]', profile.email],
        ['input[name="phone"]', profile.phone],
        ['input[name="address"]', profile.location],
      ]
      for (const [sel, val] of pairs) {
        if (fillBySelector(document, sel, val, filled)) added.push(sel)
      }
      return added
    },
  }

  function currentCompany(profile) {
    return profile.experience?.[0]?.company ?? null
  }

  // ---------- Heuristic fallback ----------

  const HEURISTIC_RULES = [
    { keys: ['given-name', 'firstname', 'first-name', 'first_name', 'fname'], value: (p) => p.firstName },
    { keys: ['family-name', 'lastname', 'last-name', 'last_name', 'lname', 'surname'], value: (p) => p.lastName },
    { keys: ['name', 'full-name', 'fullname', 'full_name'], value: (p) => p.fullName },
    { keys: ['email'], value: (p) => p.email },
    { keys: ['tel', 'phone', 'mobile', 'phone-number', 'phone_number'], value: (p) => p.phone },
    { keys: ['address', 'street-address', 'location', 'city'], value: (p) => p.location },
    { keys: ['linkedin', 'linkedin-url', 'linkedin_url'], value: (p) => p.linkedin },
    { keys: ['website', 'portfolio', 'url', 'homepage', 'personal-website'], value: (p) => p.website },
    { keys: ['current-company', 'company', 'employer', 'current_company'], value: (p) => currentCompany(p) },
    { keys: ['job-title', 'current-title', 'title', 'headline'], value: (p) => p.title },
    { keys: ['summary', 'about', 'bio', 'cover-letter', 'cover_letter'], value: (p) => p.summary },
  ]

  function heuristicFill(profile, filled) {
    const added = []
    const inputs = document.querySelectorAll('input, textarea, select')
    for (const el of inputs) {
      if (filled.has(el)) continue
      if (el.disabled || el.readOnly) continue
      if (el.type === 'hidden' || el.type === 'password' || el.type === 'file') continue
      if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button')) continue

      const signals = fieldSignals(el)
      const rule = HEURISTIC_RULES.find((r) =>
        r.keys.some((k) => signals.some((s) => s.includes(k)))
      )
      if (!rule) continue
      const value = rule.value(profile)
      if (!value) continue
      if (setInputValue(el, value)) {
        filled.add(el)
        highlight(el)
        added.push(signals[0] || el.name || el.id)
      }
    }
    return added
  }

  function fieldSignals(el) {
    const out = []
    if (el.getAttribute('autocomplete')) out.push(el.getAttribute('autocomplete').toLowerCase())
    if (el.name) out.push(el.name.toLowerCase())
    if (el.id) out.push(el.id.toLowerCase())
    if (el.getAttribute('aria-label')) out.push(el.getAttribute('aria-label').toLowerCase())
    if (el.placeholder) out.push(el.placeholder.toLowerCase())
    const labelText = findLabelText(el)
    if (labelText) out.push(labelText.toLowerCase())
    return out
  }

  function findLabelText(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (lbl?.textContent) return lbl.textContent.trim()
    }
    const parentLabel = el.closest('label')
    if (parentLabel?.textContent) return parentLabel.textContent.trim()
    return ''
  }

  // ---------- Floating badge ----------

  function showBadge({ filled, ats, job, filledEls }) {
    const host = document.createElement('div')
    host.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;'
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>
        .wrap {
          display:flex; align-items:center; gap:10px;
          padding:10px 14px;
          background:linear-gradient(135deg,#7c3aed 0%,#d946ef 60%,#ec4899 100%);
          color:#fff; border-radius:12px;
          box-shadow:0 10px 25px -5px rgba(124,58,237,.45);
          font-size:13px; font-weight:500;
          max-width:360px;
        }
        .dot { width:8px; height:8px; background:#fff; border-radius:50%; }
        .meta { font-size:11px; opacity:.85; font-weight:400; margin-top:2px; }
        button {
          background:rgba(255,255,255,.18); color:#fff; border:0;
          padding:5px 10px; border-radius:6px; font-size:11px;
          font-weight:600; cursor:pointer;
        }
        button:hover { background:rgba(255,255,255,.3); }
        .col { display:flex; flex-direction:column; }
        .actions { display:flex; gap:6px; margin-left:auto; }
      </style>
      <div class="wrap">
        <div class="dot"></div>
        <div class="col">
          <div>CV Radar filled ${filled} field${filled === 1 ? '' : 's'}</div>
          <div class="meta">${ats ? ats[0].toUpperCase() + ats.slice(1) : 'Heuristic'} · Review before submitting${job?.company ? ' · ' + escape(job.company) : ''}</div>
        </div>
        <div class="actions">
          <button id="undo">Undo</button>
          <button id="close">Dismiss</button>
        </div>
      </div>
    `
    shadow.getElementById('close').addEventListener('click', () => host.remove())
    shadow.getElementById('undo').addEventListener('click', () => {
      for (const el of filledEls) {
        setInputValue(el, '')
      }
      host.remove()
    })
    document.documentElement.appendChild(host)
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]))
  }
})()
