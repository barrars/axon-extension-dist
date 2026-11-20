const STORE_PREFIX = 'axon_'
let activeCollectionId = null
const pendingFileBuffer = {}

// ── In-Memory & Persistent System Logging ────────────────────
const MAX_LOGS = 400
let memoryLogs = []

function addLog (level, context, message, details) {
  const entry = {
    time: new Date().toISOString(),
    level: level || 'info', // 'info' | 'warn' | 'error' | 'debug'
    context: context || 'BG', // 'BG' | 'Bridge' | 'Intercept' | 'Viewer' | 'Popup'
    message: String(message || ''),
    details: details ? (typeof details === 'object' ? JSON.stringify(details).slice(0, 1000) : String(details).slice(0, 1000)) : null
  }
  memoryLogs.push(entry)
  if (memoryLogs.length > MAX_LOGS) memoryLogs.shift()

  const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  logFn(`[Axon${entry.context}] ${entry.message}`, details || '')

  // Periodic debounce storage save for logs
  scheduleLogPersist()
}

let logPersistTimer = null
function scheduleLogPersist () {
  if (logPersistTimer) return
  logPersistTimer = setTimeout(async function () {
    logPersistTimer = null
    try {
      await chrome.storage.local.set({ axon_system_logs: memoryLogs.slice(-150) })
    } catch (e) {}
  }, 2000)
}

// Restore saved logs on startup
chrome.storage.local.get('axon_system_logs').then(function (res) {
  if (res && Array.isArray(res.axon_system_logs)) {
    // Prepend past logs up to limit
    memoryLogs = res.axon_system_logs.concat(memoryLogs).slice(-MAX_LOGS)
  }
  addLog('info', 'BG', 'Axon background service worker initialized')
}).catch(function () {})

// ── Sequential Key Locks to Prevent Async Race Conditions ────
const keyLocks = {}

function runWithKeyLock (key, asyncFn) {
  if (!keyLocks[key]) {
    keyLocks[key] = Promise.resolve()
  }
  const next = keyLocks[key].then(async function () {
    return await asyncFn()
  }).catch(function (err) {
    addLog('error', 'BG', `Storage lock error for ${key}: ${err.message}`, err.stack)
    throw err
  })
  keyLocks[key] = next.catch(function () {}) // don't break the chain on errors
  return next
}

async function getStoredActiveId () {
  const result = await chrome.storage.local.get('activeCollectionId')
  return result.activeCollectionId || null
}

async function setStoredActiveId (id) {
  await chrome.storage.local.set({ activeCollectionId: id })
}

async function clearStoredActiveId () {
  await chrome.storage.local.remove('activeCollectionId')
}

function colKey (id) { return STORE_PREFIX + 'col_' + id }
function evKey (id) { return STORE_PREFIX + 'ev_' + id }
function filesKey (id) { return STORE_PREFIX + 'files_' + id }
function pagesKey (id) { return STORE_PREFIX + 'pages_' + id }
function thumbsKey (id) { return STORE_PREFIX + 'thumbs_' + id }
function foldersKey (id) { return STORE_PREFIX + 'folders_' + id }

async function recoverActiveCollectionId () {
  if (activeCollectionId) return activeCollectionId
  const stored = await getStoredActiveId()
  if (stored) {
    const result = await chrome.storage.local.get(colKey(stored))
    const existing = result[colKey(stored)]
    if (existing) {
      activeCollectionId = stored
      if (existing.status === 'paused') {
        existing.status = 'collecting'
        await chrome.storage.local.set({ [colKey(stored)]: existing })
      }
      addLog('info', 'BG', `Recovered active collection from storage: ${stored} (status: ${existing.status})`)
      return stored
    }
  }
  return null
}

function extractCaseId (url) {
  if (!url) return null
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

async function findCollectionForEvidenceIds (evIds) {
  if (!evIds || evIds.length === 0) return null
  try {
    const all = await chrome.storage.local.get(null)
    for (let i = 0; i < evIds.length; i++) {
      const rawId = evIds[i]
      const cleanId = rawId.replace(/-/g, '')
      for (const k in all) {
        if (k.startsWith(STORE_PREFIX + 'ev_')) {
          const items = all[k] || []
          for (let j = 0; j < items.length; j++) {
            if (items[j].id === rawId || (items[j].id && items[j].id.replace(/-/g, '') === cleanId)) {
              const cid = items[j].collectionId || k.replace(STORE_PREFIX + 'ev_', '')
              addLog('debug', 'BG', `Resolved collection ${cid} from evidence item ${rawId}`)
              return cid
            }
          }
        }
      }
    }
  } catch (e) {
    addLog('warn', 'BG', 'findCollectionForEvidenceIds error: ' + e.message)
  }
  return null
}

async function resolveCollectionId (explicitId, payload) {
  if (explicitId) return explicitId
  if (payload && payload.collectionId) return payload.collectionId
  if (activeCollectionId) return activeCollectionId
  const recovered = await recoverActiveCollectionId()
  if (recovered) return recovered

  // Try to find by evidence IDs
  if (payload) {
    let ids = null
    if (payload.evidenceFiles) ids = Object.keys(payload.evidenceFiles)
    else if (payload.pageCounts) ids = Object.keys(payload.pageCounts)
    else if (payload.thumbnails) ids = Object.keys(payload.thumbnails)
    if (ids && ids.length > 0) {
      const found = await findCollectionForEvidenceIds(ids)
      if (found) return found
    }
  }
  return null
}

async function createCollection (payload, pageUrl, caseLabel, collectionKey) {
  const caseId = collectionKey || (pageUrl ? extractCaseId(pageUrl) : null)
  const id = caseId || ('case_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6))
  activeCollectionId = id
  await setStoredActiveId(id)

  const ck = colKey(id)
  return runWithKeyLock(ck, async function () {
    const result = await chrome.storage.local.get(ck)
    const existing = result[ck]

    if (existing) {
      if (existing.status === 'paused') {
        existing.status = 'collecting'
      }
      existing.totalCount = payload.totalCount
      existing.totalPages = payload.totalPages
      existing.updatedAt = new Date().toISOString()
      if (caseLabel && !existing.caseLabel) existing.caseLabel = caseLabel
      if (pageUrl && !existing.pageUrl) existing.pageUrl = pageUrl
      await chrome.storage.local.set({ [ck]: existing })
      addLog('info', 'BG', `Reusing collection: ${id} (totalCount: ${payload.totalCount}, label: ${existing.caseLabel || 'none'})`)
      return id
    }

    addLog('info', 'BG', `createCollection: ${id} totalCount: ${payload.totalCount} pages: ${payload.totalPages} label: ${caseLabel || 'none'}`)
    const record = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCount: payload.totalCount,
      totalPages: payload.totalPages,
      count: 0,
      status: 'collecting',
      caseLabel: caseLabel || null,
      pageUrl: pageUrl || null,
      scrapeLevels: { initial: false, files: false, pages: false, thumbs: false }
    }
    await chrome.storage.local.set({ [ck]: record })
    await flushPendingFiles(id)
    return id
  })
}

async function storePageData (payload, targetCollectionId) {
  const cid = await resolveCollectionId(targetCollectionId, payload)
  if (!cid) {
    addLog('warn', 'BG', 'storePageData dropped: no active or target collection found', payload ? { page: payload.page, count: payload.newCount } : null)
    return
  }
  if (!payload || !payload.data) {
    addLog('warn', 'BG', `storePageData: missing payload.data for ${cid}`)
    return
  }

  const ek = evKey(cid)
  return runWithKeyLock(ek, async function () {
    const result = await chrome.storage.local.get(ek)
    const existing = result[ek] || []

    const map = {}
    existing.forEach(function (e) { map[e.id] = e })
    payload.data.forEach(function (item) {
      const id = item.id || (item.attributes && item.attributes.humanReadableReferenceNumber) || crypto.randomUUID()
      map[id] = {
        id,
        collectionId: cid,
        type: item.type,
        attributes: item.attributes,
        relationships: item.relationships
      }
    })
    const merged = Object.values(map)
    await chrome.storage.local.set({ [ek]: merged })
    addLog('info', 'BG', `storePageData: stored ${merged.length} total items in ${cid} (page: ${payload.page || '?'}, batch: ${payload.data.length})`)

    await updateCollectionCount(cid, payload.collected || merged.length)
    await flushPendingFiles(cid)
  })
}

async function updateCollectionCount (cid, collected) {
  const targetId = cid || activeCollectionId
  if (!targetId) return
  const ck = colKey(targetId)
  return runWithKeyLock(ck, async function () {
    const result = await chrome.storage.local.get(ck)
    const rec = result[ck]
    if (rec) {
      rec.count = collected
      rec.updatedAt = new Date().toISOString()
      await chrome.storage.local.set({ [ck]: rec })
    }
  })
}

async function completeCollection (payload, targetCollectionId) {
  const cid = await resolveCollectionId(targetCollectionId, payload)
  if (!cid) {
    addLog('warn', 'BG', 'completeCollection: no collection id found, dropped')
    return
  }
  const ck = colKey(cid)
  return runWithKeyLock(ck, async function () {
    const result = await chrome.storage.local.get(ck)
    const rec = result[ck]
    if (rec) {
      rec.status = 'complete'
      if (typeof payload.collected === 'number') rec.count = payload.collected
      rec.baseUrl = payload.baseUrl || rec.baseUrl || null
      rec.pageUrl = payload.pageUrl || rec.pageUrl || null
      rec.completedAt = new Date().toISOString()
      rec.updatedAt = rec.completedAt
      if (!rec.scrapeLevels) rec.scrapeLevels = { initial: false, files: false, pages: false, thumbs: false }
      rec.scrapeLevels.initial = true
      await chrome.storage.local.set({ [ck]: rec })
      addLog('info', 'BG', `completeCollection: marked ${cid} complete with ${rec.count} records`)
    }
  })
}

async function getAllCollections () {
  const all = await chrome.storage.local.get(null)
  const collections = []
  const healWrites = {}
  const deleteKeys = []

  Object.keys(all).forEach(function (k) {
    if (k.startsWith(STORE_PREFIX + 'col_')) {
      const col = all[k]
      // Heal stuck collection if it reached totalCount and totalCount > 0
      if (col.status === 'collecting' && col.totalCount > 0 && col.count >= col.totalCount) {
        col.status = 'complete'
        col.completedAt = col.completedAt || new Date().toISOString()
        col.updatedAt = col.completedAt
        healWrites[k] = col
        addLog('info', 'BG', `Healed stuck collection: ${col.id} (${col.count} records)`)
      }

      // Safe stale cleanup: only delete empty collections older than 15 minutes that are NOT collecting
      const ageMs = Date.now() - new Date(col.createdAt || 0).getTime()
      if (col.status !== 'collecting' && col.count === 0 && ageMs > 15 * 60 * 1000) {
        deleteKeys.push(k)
        addLog('info', 'BG', `Removing stale empty collection: ${col.id}`)
        return
      }
      collections.push(col)
    }
  })

  if (Object.keys(healWrites).length > 0) {
    await chrome.storage.local.set(healWrites)
  }
  if (deleteKeys.length > 0) {
    const allDeleteKeys = deleteKeys.slice()
    deleteKeys.forEach(function (k) {
      const cid = k.replace(STORE_PREFIX + 'col_', '')
      allDeleteKeys.push(evKey(cid), filesKey(cid), pagesKey(cid), thumbsKey(cid), foldersKey(cid))
    })
    await chrome.storage.local.remove(allDeleteKeys)
  }

  // Sort by most recently active first
  collections.sort(function (a, b) {
    const timeA = new Date(a.updatedAt || a.completedAt || a.createdAt || 0).getTime()
    const timeB = new Date(b.updatedAt || b.completedAt || b.createdAt || 0).getTime()
    return timeB - timeA
  })
  return collections
}

async function getCollectionEvidence (collectionId) {
  if (!collectionId) return []
  const key = evKey(collectionId)
  const result = await chrome.storage.local.get(key)
  const items = result[key] || []
  addLog('debug', 'BG', `getCollectionEvidence: ${collectionId} returned ${items.length} items`)
  return items
}

async function deleteCollection (collectionId) {
  if (!collectionId) return
  addLog('info', 'BG', `Deleting collection and all associated data: ${collectionId}`)
  await chrome.storage.local.remove([
    colKey(collectionId), evKey(collectionId), filesKey(collectionId),
    pagesKey(collectionId), thumbsKey(collectionId), foldersKey(collectionId)
  ])
  if (activeCollectionId === collectionId) {
    activeCollectionId = null
    await clearStoredActiveId()
  }
}

async function flushPendingFiles (collectionId) {
  if (!collectionId) return
  const entries = pendingFileBuffer[collectionId]
  if (entries && Object.keys(entries).length > 0) {
    const fk = filesKey(collectionId)
    await runWithKeyLock(fk, async function () {
      const result = await chrome.storage.local.get(fk)
      const existing = result[fk] || {}
      Object.keys(entries).forEach(function (evId) {
        existing[evId] = entries[evId]
        existing[evId].collectionId = collectionId
        existing[evId].evidenceId = evId
      })
      await chrome.storage.local.set({ [fk]: existing })
      addLog('info', 'BG', `Flushed ${Object.keys(entries).length} pending files for ${collectionId}`)
      delete pendingFileBuffer[collectionId]
    })
  }

  // Also check orphaned entries
  const orphaned = pendingFileBuffer.__pending__
  if (orphaned && Object.keys(orphaned).length > 0) {
    const ek = evKey(collectionId)
    const evResult = await chrome.storage.local.get(ek)
    const evItems = evResult[ek] || []
    const matched = {}
    const remaining = {}
    Object.keys(orphaned).forEach(function (evId) {
      const clean = evId.replace(/-/g, '')
      const found = evItems.some(function (item) {
        return item.id === evId || (item.id && item.id.replace(/-/g, '') === clean)
      })
      if (found) { matched[evId] = orphaned[evId] } else { remaining[evId] = orphaned[evId] }
    })
    if (Object.keys(matched).length > 0) {
      const fk = filesKey(collectionId)
      await runWithKeyLock(fk, async function () {
        const fResult = await chrome.storage.local.get(fk)
        const fExisting = fResult[fk] || {}
        Object.keys(matched).forEach(function (evId) {
          fExisting[evId] = matched[evId]
          fExisting[evId].collectionId = collectionId
          fExisting[evId].evidenceId = evId
        })
        await chrome.storage.local.set({ [fk]: fExisting })
        addLog('info', 'BG', `Flushed ${Object.keys(matched).length} orphaned files for ${collectionId}`)
      })
    }
    pendingFileBuffer.__pending__ = remaining
  }
}

async function storeFileData (payload, targetCollectionId) {
  if (!payload || !payload.evidenceFiles) return
  const evIds = Object.keys(payload.evidenceFiles)
  if (evIds.length === 0) return

  const cid = await resolveCollectionId(targetCollectionId, payload)
  if (!cid) {
    // Buffer for when collection is created
    const cidFromEv = '__pending__'
    if (!pendingFileBuffer[cidFromEv]) pendingFileBuffer[cidFromEv] = {}
    evIds.forEach(function (evId) {
      const info = payload.evidenceFiles[evId]
      pendingFileBuffer[cidFromEv][evId] = {
        fileId: info.fileId || '',
        contentType: info.contentType || '',
        fileName: info.fileName || '',
        fileType: info.fileType || '',
        partnerId: payload.partnerId || '',
        uploadedBy: info.uploadedBy || ''
      }
    })
    addLog('info', 'BG', `Buffered ${evIds.length} pending file entries under ${cidFromEv}`)
    return
  }

  const fk = filesKey(cid)
  return runWithKeyLock(fk, async function () {
    const result = await chrome.storage.local.get(fk)
    const existing = result[fk] || {}

    evIds.forEach(function (evId) {
      const info = payload.evidenceFiles[evId]
      const prev = existing[evId]
      existing[evId] = {
        evidenceId: evId,
        collectionId: cid,
        fileId: info.fileId || (prev && prev.fileId) || '',
        contentType: info.contentType || (prev && prev.contentType) || '',
        fileName: info.fileName || (prev && prev.fileName) || '',
        fileType: info.fileType || (prev && prev.fileType) || '',
        partnerId: payload.partnerId || (prev && prev.partnerId) || '',
        uploadedBy: info.uploadedBy || (prev && prev.uploadedBy) || ''
      }
    })

    await chrome.storage.local.set({ [fk]: existing })
    addLog('debug', 'BG', `storeFileData: saved ${evIds.length} file entries for ${cid} (total: ${Object.keys(existing).length})`)
  })
}

async function getCollectionFiles (collectionId) {
  if (!collectionId) return []
  const key = filesKey(collectionId)
  const result = await chrome.storage.local.get(key)
  const map = result[key] || {}
  const files = Object.values(map)
  addLog('debug', 'BG', `getCollectionFiles: ${collectionId} returned ${files.length} files`)
  return files
}

async function storePageCounts (payload, targetCollectionId) {
  if (!payload || !payload.pageCounts) return
  const evIds = Object.keys(payload.pageCounts)
  if (evIds.length === 0) return

  const cid = await resolveCollectionId(targetCollectionId, payload)
  if (!cid) {
    addLog('warn', 'BG', `storePageCounts: could not find collection for ${evIds.length} page counts`)
    return
  }

  const pk = pagesKey(cid)
  return runWithKeyLock(pk, async function () {
    const result = await chrome.storage.local.get(pk)
    const existing = result[pk] || {}

    evIds.forEach(function (evId) {
      existing[evId] = payload.pageCounts[evId]
    })

    await chrome.storage.local.set({ [pk]: existing })
    addLog('debug', 'BG', `storePageCounts: saved ${evIds.length} page counts for ${cid} (total: ${Object.keys(existing).length})`)
  })
}

async function getCollectionPages (collectionId) {
  if (!collectionId) return {}
  const key = pagesKey(collectionId)
  const result = await chrome.storage.local.get(key)
  return result[key] || {}
}

async function storeThumbnails (payload, targetCollectionId) {
  if (!payload || !payload.thumbnails) return
  const evIds = Object.keys(payload.thumbnails)
  if (evIds.length === 0) return

  const cid = await resolveCollectionId(targetCollectionId, payload)
  if (!cid) {
    addLog('warn', 'BG', `storeThumbnails: could not find collection for ${evIds.length} thumbnails`)
    return
  }

  const tk = thumbsKey(cid)
  return runWithKeyLock(tk, async function () {
    const result = await chrome.storage.local.get(tk)
    const existing = result[tk] || {}

    evIds.forEach(function (evId) {
      existing[evId] = payload.thumbnails[evId]
    })

    await chrome.storage.local.set({ [tk]: existing })
    addLog('debug', 'BG', `storeThumbnails: saved ${evIds.length} thumbnails for ${cid} (total: ${Object.keys(existing).length})`)
  })
}

async function getCollectionThumbnails (collectionId) {
  if (!collectionId) return {}
  const key = thumbsKey(collectionId)
  const result = await chrome.storage.local.get(key)
  return result[key] || {}
}

async function storeFolderData (payload, targetCollectionId) {
  if (!payload || !payload.folders) return
  const folderMap = payload.folders
  const folderIds = Object.keys(folderMap)
  if (folderIds.length === 0) return

  const cid = await resolveCollectionId(targetCollectionId, payload)
  if (!cid) {
    addLog('warn', 'BG', `storeFolderData: no active collection found for ${folderIds.length} folders`)
    return
  }

  const fdk = foldersKey(cid)
  return runWithKeyLock(fdk, async function () {
    const result = await chrome.storage.local.get(fdk)
    const existing = result[fdk] || {}

    folderIds.forEach(function (fid) {
      existing[fid] = folderMap[fid]
    })

    await chrome.storage.local.set({ [fdk]: existing })
    addLog('debug', 'BG', `storeFolderData: saved ${folderIds.length} folder names for ${cid} (total: ${Object.keys(existing).length})`)
  })
}

async function getCollectionFolders (collectionId) {
  if (!collectionId) return {}
  const key = foldersKey(collectionId)
  const result = await chrome.storage.local.get(key)
  return result[key] || {}
}

async function markLevelComplete (level, collectionId) {
  const cid = await resolveCollectionId(collectionId)
  if (!cid) {
    addLog('warn', 'BG', `markLevelComplete: no collection id found for level ${level}`)
    return
  }
  const ck = colKey(cid)
  return runWithKeyLock(ck, async function () {
    const result = await chrome.storage.local.get(ck)
    const rec = result[ck]
    if (rec) {
      if (!rec.scrapeLevels) rec.scrapeLevels = { initial: false, files: false, pages: false, thumbs: false }
      rec.scrapeLevels[level] = true
      rec.updatedAt = new Date().toISOString()
      await chrome.storage.local.set({ [ck]: rec })
      addLog('info', 'BG', `Marked scrape level '${level}' complete for ${cid}`)
    }
  })
}

async function clearAllData () {
  addLog('warn', 'BG', 'Clearing all evidence and collection data')
  const all = await chrome.storage.local.get(null)
  const keys = Object.keys(all).filter(function (k) {
    return k.startsWith(STORE_PREFIX) || k === 'activeCollectionId'
  })
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys)
  }
  activeCollectionId = null
  Object.keys(pendingFileBuffer).forEach(k => delete pendingFileBuffer[k])
}

// ── Update Check ─────────────────────────────────────────────
// Chrome does not let an extension replace its own files, and MV3 forbids
// fetching code to run (remote hosted code). So this only reports that a newer
// build exists and links to the download; the user (or update-extension.sh)
// swaps the files and Chrome reloads them. Unpacked installs never auto-update.
//
// The feed must be reachable WITHOUT credentials and must send
// `Access-Control-Allow-Origin: *` (raw.githubusercontent.com does). It is a
// public repo holding only the built extension (see publish-dist.sh) — never
// this private source repo, whose history contains case-data captures.
// Point elsewhere at runtime, no rebuild needed:
//   chrome.storage.local.set({ axon_update_feed: { manifestUrl, downloadUrl, repoUrl } })
const UPDATE_DIST_REPO = 'barrars/axon-extension-dist'
const UPDATE_DIST_BRANCH = 'main'
// GitHub's branch archives are CDN-cached and can still serve the previous
// build for a few minutes after a publish, so the download prefers the
// per-release tag archive, which is immutable.
const UPDATE_FEED_DEFAULTS = {
  manifestUrl: 'https://raw.githubusercontent.com/' + UPDATE_DIST_REPO + '/' + UPDATE_DIST_BRANCH + '/manifest.json',
  downloadUrl: 'https://github.com/' + UPDATE_DIST_REPO + '/archive/refs/heads/' + UPDATE_DIST_BRANCH + '.zip',
  tagDownloadUrl: 'https://github.com/' + UPDATE_DIST_REPO + '/archive/refs/tags/v{version}.zip',
  repoUrl: 'https://github.com/' + UPDATE_DIST_REPO
}
const UPDATE_CACHE_KEY = 'axon_update_check'
const UPDATE_FEED_KEY = 'axon_update_feed'
const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000
const UPDATE_TIMEOUT_MS = 8000

async function getUpdateConfig () {
  const config = Object.assign({}, UPDATE_FEED_DEFAULTS)
  try {
    const stored = await chrome.storage.local.get(UPDATE_FEED_KEY)
    const custom = stored && stored[UPDATE_FEED_KEY]
    if (custom && typeof custom === 'object') {
      ['manifestUrl', 'downloadUrl', 'tagDownloadUrl', 'repoUrl'].forEach(function (field) {
        if (typeof custom[field] === 'string' && custom[field]) config[field] = custom[field]
      })
    }
  } catch (e) {}
  return config
}

function parseVersionParts (version) {
  return String(version || '').split('.').map(function (part) {
    return parseInt(part, 10) || 0
  })
}

// Returns 1 when a > b, -1 when a < b, 0 when equal. Handles the date-based
// versions (2026.11.20, 2026.11.20.1) as well as the old 1.14.8 style.
function compareVersions (a, b) {
  const pa = parseVersionParts(a)
  const pb = parseVersionParts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

async function fetchLatestVersion (manifestUrl) {
  const controller = new AbortController()
  const timer = setTimeout(function () { controller.abort() }, UPDATE_TIMEOUT_MS)
  try {
    const resp = await fetch(manifestUrl, { cache: 'no-store', signal: controller.signal })
    if (resp.status === 404) throw new Error('feed not found (404) — is the update repo/public URL set up?')
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    const version = data && data.version
    if (!version) throw new Error('feed has no version field')
    return String(version)
  } finally {
    clearTimeout(timer)
  }
}

function downloadUrlFor (config, latest) {
  if (latest && config.tagDownloadUrl) return config.tagDownloadUrl.replace('{version}', latest)
  return config.downloadUrl
}

function buildUpdateStatus (config, current, latest, checkedAt, error) {
  return {
    ok: !error,
    error: error || null,
    current: current,
    latest: latest || null,
    checkedAt: checkedAt || null,
    updateAvailable: !!(latest && compareVersions(latest, current) > 0),
    downloadUrl: downloadUrlFor(config, latest),
    repoUrl: config.repoUrl
  }
}

function syncActionBadge (latest, current) {
  try {
    const available = !!(latest && compareVersions(latest, current) > 0)
    chrome.action.setBadgeText({ text: available ? '↑' : '' })
    chrome.action.setBadgeBackgroundColor({ color: '#38bdf8' })
    chrome.action.setTitle({ title: available ? 'Evidence Aggregator — v' + latest + ' available' : 'Evidence Aggregator' })
  } catch (e) {}
}

async function checkForUpdate (force) {
  const current = chrome.runtime.getManifest().version
  const config = await getUpdateConfig()

  let cached = null
  try {
    const stored = await chrome.storage.local.get(UPDATE_CACHE_KEY)
    cached = (stored && stored[UPDATE_CACHE_KEY]) || null
  } catch (e) {}

  const fresh = !!(cached && cached.latest && cached.checkedAt && (Date.now() - cached.checkedAt) < UPDATE_CACHE_MS)
  if (fresh && !force) {
    return buildUpdateStatus(config, current, cached.latest, cached.checkedAt, null)
  }

  try {
    const latest = await fetchLatestVersion(config.manifestUrl)
    const record = { latest: latest, checkedAt: Date.now() }
    try { await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: record }) } catch (e) {}
    syncActionBadge(latest, current)
    addLog('info', 'BG', 'Update check: running v' + current + ', latest v' + latest)
    return buildUpdateStatus(config, current, latest, record.checkedAt, null)
  } catch (e) {
    // Keep the last known good version: a network blip must not hide an update
    // that was already announced, and failures are not cached. A missing feed
    // is expected when no public URL is configured yet, so it stays out of the
    // warning stream (it would otherwise fire on every browser start).
    addLog(force ? 'warn' : 'debug', 'BG', 'Update check failed: ' + e.message)
    return buildUpdateStatus(config, current, cached && cached.latest, cached && cached.checkedAt, e.message)
  }
}

// ── Message Listener ─────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async () => {
    try {
      switch (msg.action) {
        case 'start-collection': {
          const id = await createCollection(msg.payload, msg.pageUrl, msg.caseLabel, msg.collectionKey)
          const ck = colKey(id)
          const result = await chrome.storage.local.get(ck)
          const rec = result[ck]
          if (rec && rec.status === 'complete' && rec.count >= msg.payload.totalCount && msg.payload.totalCount > 0) {
            try { sendResponse({ alreadyComplete: true, collectionId: id, count: rec.count, scrapeLevels: rec.scrapeLevels, caseLabel: rec.caseLabel }) } catch (e) {}
            return
          }
          try { sendResponse({ alreadyComplete: false, collectionId: id }) } catch (e) {}
          break
        }
        case 'store-page-data':
          await storePageData(msg.payload, msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'collection-progress':
          if (msg.payload) {
            await updateCollectionCount(msg.collectionId || activeCollectionId, msg.payload.collected)
          }
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'collection-complete':
          await completeCollection(msg.payload, msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'collection-paused':
          if (activeCollectionId || msg.collectionId) {
            const cid = msg.collectionId || activeCollectionId
            const pkey = colKey(cid)
            await runWithKeyLock(pkey, async function () {
              const presult = await chrome.storage.local.get(pkey)
              const prec = presult[pkey]
              if (prec) {
                prec.status = 'paused'
                prec.updatedAt = new Date().toISOString()
                await chrome.storage.local.set({ [pkey]: prec })
                addLog('info', 'BG', `Collection paused: ${cid}`)
              }
            })
          }
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'open-viewer':
          var viewerBase = chrome.runtime.getURL('viewer.html')
          var viewerUrl = viewerBase + (msg.collectionId ? '#collectionId=' + msg.collectionId : '')
          addLog('info', 'BG', `Opening viewer at ${viewerUrl}`)
          try {
            chrome.tabs.query({}, function (tabs) {
              var existing = tabs && tabs.find(function (t) { return t.url && t.url.indexOf(viewerBase) === 0 })
              if (existing) {
                chrome.tabs.update(existing.id, { active: true, url: viewerUrl })
                if (existing.windowId) {
                  chrome.windows.update(existing.windowId, { focused: true }).catch(function () {})
                }
              } else {
                chrome.tabs.create({ url: viewerUrl })
              }
            })
          } catch (e) {
            chrome.tabs.create({ url: viewerUrl })
          }
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'get-collections':
          var cols = await getAllCollections()
          try { sendResponse({ collections: cols }) } catch (e) {}
          break
        case 'get-evidence':
          var evidence = await getCollectionEvidence(msg.collectionId)
          try { sendResponse({ evidence }) } catch (e) {}
          break
        case 'store-file-data':
          await storeFileData(msg.payload, msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'store-page-counts':
          await storePageCounts(msg.payload, msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'store-folder-data':
          await storeFolderData(msg.payload, msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'store-thumbnails':
          await storeThumbnails(msg.payload, msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'files-fetch-done':
          await markLevelComplete('files', msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'pages-fetch-done':
          await markLevelComplete('pages', msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'thumbs-fetch-done':
          await markLevelComplete('thumbs', msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'get-files':
          var files = await getCollectionFiles(msg.collectionId)
          try { sendResponse({ files }) } catch (e) {}
          break
        case 'get-pages':
          var pages = await getCollectionPages(msg.collectionId)
          try { sendResponse({ pages }) } catch (e) {}
          break
        case 'get-thumbnails':
          var thumbs = await getCollectionThumbnails(msg.collectionId)
          try { sendResponse({ thumbnails: thumbs }) } catch (e) {}
          break
        case 'get-folders':
          var folders = await getCollectionFolders(msg.collectionId)
          try { sendResponse({ folders }) } catch (e) {}
          break
        case 'delete-collection':
          await deleteCollection(msg.collectionId)
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'fetch-detail':
          if (msg.url) {
            chrome.tabs.create({ url: msg.url, active: false })
          }
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'clear-all':
          await clearAllData()
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'check-case': {
          const caseId = msg.url ? extractCaseId(msg.url) : null
          let col = null
          if (caseId) {
            const ck = colKey(caseId)
            const cr = await chrome.storage.local.get(ck)
            col = cr[ck]
          }
          if (!col && msg.url) {
            // Also search collections by matching pageUrl
            const allCols = await getAllCollections()
            col = allCols.find(function (c) {
              return c.pageUrl && (c.pageUrl === msg.url || c.pageUrl.split('?')[0] === msg.url.split('?')[0])
            })
          }
          if (col) {
            if (col.status === 'collecting' && col.totalCount > 0 && col.count >= col.totalCount) {
              col.status = 'complete'
              col.completedAt = col.completedAt || new Date().toISOString()
              col.updatedAt = col.completedAt
              if (!col.scrapeLevels) col.scrapeLevels = { initial: false, files: false, pages: false, thumbs: false }
              col.scrapeLevels.initial = true
              await chrome.storage.local.set({ [colKey(col.id)]: col })
              addLog('info', 'BG', `check-case: auto-healed ${col.id}`)
            }
            if (!col.scrapeLevels) col.scrapeLevels = { initial: false, files: false, pages: false, thumbs: false }
            try { sendResponse({ found: true, collection: col }) } catch (e) {}
          } else {
            try { sendResponse({ found: false }) } catch (e) {}
          }
          break
        }
        case 'rename-collection': {
          const rk = colKey(msg.collectionId)
          await runWithKeyLock(rk, async function () {
            const rr = await chrome.storage.local.get(rk)
            const rrec = rr[rk]
            if (rrec && msg.name != null) {
              rrec.caseLabel = msg.name
              rrec.updatedAt = new Date().toISOString()
              await chrome.storage.local.set({ [rk]: rrec })
              addLog('info', 'BG', `Renamed collection ${msg.collectionId} to "${msg.name}"`)
              try { sendResponse({ ok: true }) } catch (e) {}
            } else {
              try { sendResponse({ ok: false }) } catch (e) {}
            }
          })
          break
        }
        case 'cancel-collection':
          if (activeCollectionId || msg.collectionId) {
            const cid = msg.collectionId || activeCollectionId
            const ckey = colKey(cid)
            await runWithKeyLock(ckey, async function () {
              const cresult = await chrome.storage.local.get(ckey)
              const crec = cresult[ckey]
              if (crec) {
                crec.status = 'cancelled'
                crec.updatedAt = new Date().toISOString()
                await chrome.storage.local.set({ [ckey]: crec })
                addLog('warn', 'BG', `Cancelled collection: ${cid}`)
              }
              if (activeCollectionId === cid) {
                activeCollectionId = null
                await clearStoredActiveId()
              }
            })
          }
          try { sendResponse({ ok: true }) } catch (e) {}
          break
        case 'get-logs':
          try {
            sendResponse({ logs: memoryLogs })
          } catch (e) {}
          break
        case 'clear-logs':
          memoryLogs = []
          await chrome.storage.local.remove('axon_system_logs')
          addLog('info', 'BG', 'System logs cleared')
          try {
            sendResponse({ ok: true })
          } catch (e) {}
          break
        case 'check-update': {
          const update = await checkForUpdate(msg.force === true)
          try { sendResponse({ update: update }) } catch (e) {}
          break
        }
        case 'log-event':
          addLog(msg.level || 'info', msg.context || 'Ext', msg.message, msg.details)
          try {
            sendResponse({ ok: true })
          } catch (e) {}
          break
      }
    } catch (e) {
      addLog('error', 'BG', `Handler error on action ${msg.action}: ${e.message}`, e.stack)
      try { sendResponse({ error: (e && e.message) || 'background error' }) } catch (err) {}
    }
  })()
  return true
})

chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') })
})

// Check once per browser start / install so the toolbar badge can advertise an
// update even if the popup is never opened. Results are cached (see UPDATE_CACHE_MS).
chrome.runtime.onStartup.addListener(function () {
  checkForUpdate(false).catch(function () {})
})
chrome.runtime.onInstalled.addListener(function () {
  checkForUpdate(false).catch(function () {})
})
