let currentCollectionId = null

// ── Version ─────────────────────────────────────────────────
// Versions are date-based (YYYY.M.D), plus a same-day build number, so the
// popup communicates when this copy of the extension was built.
function parseVersionDate (version) {
  const m = String(version).match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}

function renderVersion () {
  const el = document.getElementById('version_text')
  if (!el) return
  let version = ''
  try {
    version = chrome.runtime.getManifest().version
  } catch (e) {
    version = ''
  }
  if (!version) {
    el.textContent = 'v\u2014'
    return
  }
  el.textContent = 'v' + version
  const released = parseVersionDate(version)
  el.title = (released
    ? 'Released ' + released.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Version ' + version) + ' — click to check for updates'
}

// ── Update check ────────────────────────────────────────────
// The background worker does the fetch (cache + timeout live there); this only
// renders the result. Chrome never lets the extension install the download
// itself, so the banner points at the zip and explains the Reload step.
const updateBanner = document.getElementById('update_banner')
const updateVersionEl = document.getElementById('update_version')
const updateNoteEl = document.getElementById('update_note')
const btnUpdate = document.getElementById('btn_update')
const versionBtn = document.getElementById('version_text')
let updateInfo = null
let updateNoteTimer = null

function showUpdateNote (text, isError) {
  if (!updateNoteEl) return
  updateNoteEl.textContent = text
  updateNoteEl.className = 'update-note' + (isError ? ' error' : '')
  updateNoteEl.style.display = 'block'
  if (updateNoteTimer) clearTimeout(updateNoteTimer)
  updateNoteTimer = setTimeout(function () {
    updateNoteEl.style.display = 'none'
  }, 5000)
}

function renderUpdate (info, manual) {
  updateInfo = info || null
  if (updateBanner) {
    updateBanner.style.display = info && info.updateAvailable ? 'block' : 'none'
  }
  if (info && info.updateAvailable && updateVersionEl) {
    updateVersionEl.textContent = 'v' + info.latest
  }
  if (!info || !manual) return
  if (info.error) {
    showUpdateNote('Update check failed: ' + info.error, true)
  } else if (!info.updateAvailable) {
    showUpdateNote('On the latest build (v' + info.current + ').', false)
  }
}

async function checkForUpdates (manual) {
  if (versionBtn) versionBtn.classList.add('checking')
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'check-update', force: !!manual })
    renderUpdate(resp && resp.update, manual)
  } catch (e) {
    renderUpdate({ error: e.message || 'unreachable' }, manual)
  } finally {
    if (versionBtn) versionBtn.classList.remove('checking')
  }
}

if (versionBtn) {
  versionBtn.addEventListener('click', function () {
    checkForUpdates(true)
  })
}

if (btnUpdate) {
  btnUpdate.addEventListener('click', async function () {
    const url = (updateInfo && updateInfo.downloadUrl) || 'https://github.com/barrars/axon-extension'
    try {
      await chrome.runtime.sendMessage({ action: 'log-event', level: 'info', context: 'Popup', message: 'Update download opened from popup' })
    } catch (e) {}
    try {
      await chrome.tabs.create({ url: url })
    } catch (e) {
      window.open(url, '_blank')
    }
    window.close()
  })
}

document.getElementById('btn_open').addEventListener('click', function () {
  chrome.runtime.sendMessage({
    action: 'open-viewer',
    collectionId: currentCollectionId || undefined
  })
})

document.getElementById('btn_clear').addEventListener('click', function () {
  if (confirm('Delete all collected evidence data?')) {
    chrome.runtime.sendMessage({ action: 'clear-all' })
    currentCollectionId = null
    updateUI({ active: false })
  }
})

// ── Volume Boost ─────────────────────────────────────────────
let volMultiplier = 1
const volDisplay = document.getElementById('vol_display')

function updateVolDisplay () {
  volDisplay.textContent = volMultiplier + '\u00d7'
}

document.getElementById('btn_vol_up').addEventListener('click', function () {
  volMultiplier = Math.min(volMultiplier + 1, 10)
  updateVolDisplay()
})

document.getElementById('btn_vol_down').addEventListener('click', function () {
  volMultiplier = Math.max(volMultiplier - 1, 1)
  updateVolDisplay()
})

document.getElementById('btn_vol_apply').addEventListener('click', async function () {
  const mult = volMultiplier
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tabs || !tabs[0]) return
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: function (multiplier) {
        const media = document.querySelector('video') || document.querySelector('audio')
        if (!media) { console.warn('[AxonExt] No media element found'); return }
        // Re-use existing gain node if already set up
        if (window.__axonAudioCtx && window.__axonGainNode) {
          window.__axonGainNode.gain.value = multiplier
          console.log('[AxonExt] Volume updated to', multiplier + 'x')
          return
        }
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        const source = audioCtx.createMediaElementSource(media)
        const gainNode = audioCtx.createGain()
        gainNode.gain.value = multiplier
        source.connect(gainNode)
        gainNode.connect(audioCtx.destination)
        window.__axonAudioCtx = audioCtx
        window.__axonGainNode = gainNode
        console.log('[AxonExt] Volume boosted to', multiplier + 'x')
      },
      args: [mult]
    })
  } catch (e) {
    console.error('[AxonExt] Volume boost failed:', e)
  }
})

function extractCaseId (url) {
  let m = url.match(/\/case\/([a-fA-F0-9-]+)/)
  if (m) return m[1]
  m = url.match(/caseId=([a-fA-F0-9-]+)/)
  if (m) return m[1]
  m = url.match(/sharedWithBatchId=([a-fA-F0-9-]+)/)
  if (m) return m[1]
  m = url.match(/batch_id=([a-fA-F0-9-]+)/)
  if (m) return m[1]
  return null
}

async function refreshStatus () {
  try {
    let tabMatch = null

    // Try to find the collection for the current tab's case
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabs && tabs[0] && tabs[0].url) {
        const caseId = extractCaseId(tabs[0].url)
        if (caseId) {
          const caseResp = await chrome.runtime.sendMessage({ action: 'check-case', url: tabs[0].url })
          if (caseResp && caseResp.found && caseResp.collection) {
            tabMatch = caseResp.collection
          }
        }
      }
    } catch (e) {
      // tabs permission might not be available in all contexts
    }

    if (tabMatch) {
      renderCollection(tabMatch, '(current case)')
      return
    }

    // Fall back to latest global collection
    const response = await chrome.runtime.sendMessage({ action: 'get-collections' })
    if (response && response.collections && response.collections.length > 0) {
      const latest = response.collections[0] // sorted newest-first
      renderCollection(latest, '(latest)')
      return
    }

    currentCollectionId = null
    updateUI({ active: false })
  } catch (e) {
    currentCollectionId = null
    updateUI({ active: false })
  }
}

function renderCollection (col, label) {
  currentCollectionId = col.id
  const status = col.status
  let state = { active: false }
  const prefix = col.caseLabel ? col.caseLabel + ' ' : ''

  if (status === 'collecting') {
    state = {
      active: true,
      status: prefix + 'Collecting... ' + label,
      dotClass: 'active',
      progress: col.count ? col.count + ' / ' + col.totalCount : '...'
    }
  } else if (status === 'complete') {
    state = {
      active: false,
      status: prefix + 'Complete — ' + col.count + ' records ' + label,
      dotClass: 'done',
      progress: col.count + ' records'
    }
  } else if (status === 'paused') {
    state = {
      active: false,
      status: prefix + 'Paused ' + label,
      dotClass: 'idle',
      progress: col.count ? col.count + ' / ' + col.totalCount : '...'
    }
  } else if (status === 'error' || status === 'cancelled') {
    state = {
      active: false,
      status: prefix + (status === 'error' ? 'Error' : 'Cancelled') + ' ' + label,
      dotClass: 'error',
      progress: col.count ? col.count + ' / ' + col.totalCount : '...'
    }
  }

  updateUI(state)
}

function updateUI (state) {
  const statusEl = document.getElementById('status_text')
  const progressEl = document.getElementById('progress_text')
  const progressSection = document.getElementById('progress_section')

  if (state.active) {
    statusEl.innerHTML = '<span class="status-dot ' + state.dotClass + '"></span>' + state.status
    if (state.progress) {
      progressSection.style.display = 'block'
      progressEl.textContent = state.progress
    }
  } else {
    statusEl.innerHTML = '<span class="status-dot ' + (state.dotClass || 'idle') + '"></span>' + (state.status || 'Idle')
    progressSection.style.display = state.status ? 'block' : 'none'
    if (state.progress) progressEl.textContent = state.progress
  }
}

async function loadLogs () {
  const preview = document.getElementById('logs_preview')
  if (!preview) return
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'get-logs' })
    const logs = (resp && resp.logs) ? resp.logs : []
    if (logs.length === 0) {
      preview.textContent = 'No logs recorded.'
      return
    }
    preview.textContent = logs.slice(-60).map(function (e) {
      const time = e.time ? new Date(e.time).toLocaleTimeString() : ''
      return time + ' [' + e.level + '] ' + (e.cat ? '[' + e.cat + '] ' : '') + e.msg
    }).join('\n')
    preview.scrollTop = preview.scrollHeight
  } catch (e) {
    preview.textContent = 'Failed to load logs: ' + e.message
  }
}

const btnLogs = document.getElementById('btn_logs')
const logsContainer = document.getElementById('logs_container')
if (btnLogs && logsContainer) {
  btnLogs.addEventListener('click', function () {
    const isHidden = logsContainer.style.display === 'none'
    logsContainer.style.display = isHidden ? 'block' : 'none'
    if (isHidden) loadLogs()
  })
}

const btnCopyLogs = document.getElementById('btn_copy_logs')
if (btnCopyLogs) {
  btnCopyLogs.addEventListener('click', async function () {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'get-logs' })
      const logs = (resp && resp.logs) ? resp.logs : []
      const text = logs.map(function (e) {
        return '[' + e.time + '] [' + e.level + '] [' + (e.cat || '') + '] ' + e.msg
      }).join('\n')
      await navigator.clipboard.writeText(text)
      const old = btnCopyLogs.textContent
      btnCopyLogs.textContent = 'Copied!'
      setTimeout(function () { btnCopyLogs.textContent = old }, 1500)
    } catch (e) {
      alert('Copy failed: ' + e.message)
    }
  })
}

const btnClearLogs = document.getElementById('btn_clear_logs')
if (btnClearLogs) {
  btnClearLogs.addEventListener('click', async function () {
    if (!confirm('Clear all logs?')) return
    await chrome.runtime.sendMessage({ action: 'clear-logs' })
    loadLogs()
  })
}

renderVersion()
checkForUpdates(false)
refreshStatus()
setInterval(refreshStatus, 2000)
