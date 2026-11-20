(function () {
  'use strict'

  const EVIDENCE_API_PATTERN = /\/api\/v\d\/agencies\/[^/]+\/evidence/
  const DRAWBRIDGE_FOLDERS_PATTERN = /\/api\/drawbridge\/folders/
  const GETSUMMARY_PATTERN = /\/index\.aspx\?.*class=Evidence.*action=getsummary/
  const BATCH_DELAY_MS = 600

  let activeSession = null
  let pendingScan = null
  let capturedHeaders = null
  const capturedCredentials = null
  let bypassInterceptor = false
  const pageLoadId = Date.now().toString(36)
  let agencyIdCompact = ''
  let partnerIdCompact = ''
  let savedEvidenceItems = null
  let filesFetched = false
  const fetchedFileIds = new Set()
  const savedFileMap = {}
  const detailTasks = {
    files: null,
    pages: null,
    thumbs: null
  }

  console.log('[AxonExt] Initialized on', window.location.href, 'pageLoadId:', pageLoadId)

  function emit (type, payload) {
    let safe
    try {
      safe = JSON.parse(JSON.stringify(payload))
    } catch (e) {
      console.error('[AxonExt] emit failed for', type, ':', e.message)
      safe = payload
    }
    console.log('[AxonExt] emit:', type, JSON.stringify(safe).slice(0, 200))
    window.postMessage({ source: 'axon-intercept', type, payload: safe, pageLoadId }, '*')
  }

  function matchesEvidenceApi (url) {
    try {
      return EVIDENCE_API_PATTERN.test(String(url))
    } catch (e) {
      return false
    }
  }

  function matchesDrawbridgeFolders (url) {
    try {
      return DRAWBRIDGE_FOLDERS_PATTERN.test(String(url))
    } catch (e) {
      return false
    }
  }

  function matchesGetSummary (url) {
    try {
      return GETSUMMARY_PATTERN.test(String(url))
    } catch (e) {
      return false
    }
  }

  function flattenFolderTree (folders, map) {
    if (!folders || !Array.isArray(folders)) return
    folders.forEach(function (f) {
      if (f && f.id) {
        map[f.id] = { name: f.name || '', path: f.path || '' }
      }
      if (f && f.children && Array.isArray(f.children)) {
        flattenFolderTree(f.children, map)
      }
    })
  }

  function handleDrawbridgeResponse (url, data) {
    if (!data) return
    // folder-tree response: { folders: [...] }
    if (data.folders && Array.isArray(data.folders)) {
      const folderMap = {}
      flattenFolderTree(data.folders, folderMap)
      const names = Object.keys(folderMap)
      if (names.length > 0) {
        console.log('[AxonExt] Captured', names.length, 'folder names from folder-tree')
        emit('folder-data', { folders: folderMap })
      }
      return
    }
    // folders/contents response: { data: [...], ... }
    if (data.data && Array.isArray(data.data)) {
      const folderMap2 = {}
      data.data.forEach(function (item) {
        if (item && item.type === 'folder' && item.id && item.attributes && item.attributes.name) {
          folderMap2[item.id] = { name: item.attributes.name, path: '' }
        }
      })
      const names2 = Object.keys(folderMap2)
      if (names2.length > 0) {
        console.log('[AxonExt] Captured', names2.length, 'folder names from folder contents')
        emit('folder-data', { folders: folderMap2 })
      }
    }
  }

  function handleGetSummaryResponse (url, data) {
    if (!data || !data.xml) return
    try {
      const view = data.xml.evidence && data.xml.evidence.view
      if (!view || view.action !== 'getsummary') return
      const evidence = view.evidence
      const files = view.files
      if (!evidence || !files || !files.file) return

      const evIdStripped = evidence.evidence_id || ''
      const evId = evIdStripped.length === 32
        ? evIdStripped.substr(0, 8) + '-' + evIdStripped.substr(8, 4) + '-' + evIdStripped.substr(12, 4) + '-' + evIdStripped.substr(16, 4) + '-' + evIdStripped.substr(20)
        : evIdStripped
      const partnerId = evidence.partner_id || ''

      const ev = view.evidence
      const upByName = [ev.uploaded_by_first_name, ev.uploaded_by_last_name].filter(Boolean).join(' ') ||
                       ev.uploaded_by_name || ev.uploaded_by || ''

      const fileEntries = Array.isArray(files.file) ? files.file : [files.file]
      for (let i = 0; i < fileEntries.length; i++) {
        const f = fileEntries[i]
        if (!f || !f.file_id) continue
        const fileInfo = {
          fileId: f.file_id,
          contentType: f.content_type || f.content_descriptor || '',
          fileName: f.filename || '',
          fileType: (f.type || '').replace(/_/g, '').replace(/^./, function (m) { return m.toUpperCase() }),
          uploadedBy: upByName
        }
        if (!partnerIdCompact && partnerId) partnerIdCompact = partnerId.replace(/-/g, '')
        if (!agencyIdCompact) agencyIdCompact = partnerId || ''

        fetchedFileIds.add(evId)
        savedFileMap[evId] = fileInfo

        const fileMap = {}
        fileMap[evId] = fileInfo
        emit('file-data', { evidenceFiles: fileMap, partnerId: (partnerId || '').replace(/-/g, '') })
        console.log('[AxonExt] Captured file_id from getsummary:', f.file_id, 'for evidence:', evId, 'name:', f.filename)
      }
    } catch (e) {
      console.warn('[AxonExt] handleGetSummaryResponse error:', e.message)
    }
  }

  function buildPageUrl (baseUrlObj, offset) {
    const u = new URL(baseUrlObj.href)
    u.searchParams.set('offset', String(offset))
    return u.href
  }

  function extractHeaders (initHeaders) {
    if (!initHeaders) return {}
    if (initHeaders instanceof Headers) {
      const obj = {}
      initHeaders.forEach(function (v, k) { obj[k] = v })
      return obj
    }
    if (typeof initHeaders === 'object') {
      const copy = {}
      Object.keys(initHeaders).forEach(function (k) { copy[k] = initHeaders[k] })
      return copy
    }
    return {}
  }

  function extractAgencyId (url) {
    const match = url.match(/\/agencies\/([^\/?\s]+)/)
    return match ? match[1] : ''
  }

  function relId (rel) {
    if (!rel) return null
    return rel.id || (rel.data && rel.data.id) || null
  }

  function enrichItemsWithUsers (items, usersById) {
    items.forEach(function (item) {
      const attrs = item.attributes || {}
      const rels = item.relationships || {}
      const ownerId = relId(rels.owner)
      const upById = relId(rels.uploadedBy)
      const caById = relId(rels.caseAddedBy)
      if (ownerId && usersById[ownerId]) attrs._owner = usersById[ownerId]
      if (upById && usersById[upById]) attrs._uploadedBy = usersById[upById]
      if (caById && usersById[caById]) attrs._caseAddedBy = usersById[caById]
      item.attributes = attrs
    })
  }

  function extractFilesFromPage (pageData) {
    const filesById = {}
    const usersById = {}
    const included = pageData.included || []
    included.forEach(function (inc) {
      if (inc.type === 'file') {
        filesById[inc.id] = {
          fileId: inc.id,
          contentType: inc.attributes?.contentType || '',
          fileName: inc.attributes?.fileName || '',
          fileType: inc.attributes?.fileType || ''
        }
      } else if (inc.type === 'user') {
        const a = inc.attributes || {}
        usersById[inc.id] = (a.firstName || '') + ' ' + (a.lastName || '').trim()
        if (!usersById[inc.id].trim()) usersById[inc.id] = a.email || a.login || inc.id
      }
    })
    const evidenceFiles = {}
    const evidenceUsers = {};
    (pageData.data || []).forEach(function (item) {
      let fileRefs = item.relationships?.files?.data
      if (!fileRefs) fileRefs = []
      if (!Array.isArray(fileRefs)) fileRefs = [fileRefs]
      if (fileRefs.length > 0) {
        let master = fileRefs[0]
        for (let i = 0; i < fileRefs.length; i++) {
          const info = filesById[fileRefs[i].id]
          if (info && info.fileType === 'MasterCopy') { master = fileRefs[i]; break }
        }
        if (master && filesById[master.id]) {
          const upByIdForFile = relId(item.relationships?.uploadedBy)
          evidenceFiles[item.id] = Object.assign({}, filesById[master.id], {
            uploadedBy: (upByIdForFile && usersById[upByIdForFile]) || ''
          })
        }
      }
      const ownerId = relId(item.relationships?.owner)
      const upById = relId(item.relationships?.uploadedBy)
      if (ownerId && usersById[ownerId]) evidenceUsers[item.id + '_owner'] = usersById[ownerId]
      if (upById && usersById[upById]) evidenceUsers[item.id + '_upby'] = usersById[upById]
    })
    return { evidenceFiles, evidenceUsers, usersById }
  }

  function buildThumbUrl (partnerId, evidenceId) {
    return '/api/v1/media/evidence/thumbnail?evidence_id=' + (evidenceId || '').replace(/-/g, '') +
      '&partner_id=' + (partnerId || '').replace(/-/g, '') +
      '&width=197&height=132'
  }

  function fetchJson (url, headers) {
    const hdrs = {}
    Object.keys(headers).forEach(function (k) { hdrs[k] = headers[k] })
    delete hdrs['content-length']
    delete hdrs.host
    delete hdrs.origin
    delete hdrs.referer

    bypassInterceptor = true
    return nativeFetch(url, { method: 'GET', headers: hdrs, credentials: capturedCredentials || 'include' })
      .then(function (resp) {
        if (resp.status === 401 || resp.status === 403) {
          const err = new Error('Auth: ' + resp.status)
          err.authError = true
          throw err
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText)
        return resp.json()
      })
      .then(function (data) {
        bypassInterceptor = false
        return data
      })
      .catch(function (e) {
        bypassInterceptor = false
        throw e
      })
  }

  function fetchJsonWithRetry (url, headers, maxRetries) {
    maxRetries = (typeof maxRetries === 'number') ? maxRetries : 2
    let attempt = 0

    function tryFetch () {
      return fetchJson(url, headers)
        .catch(function (err) {
          if (err.authError) throw err
          attempt++
          if (attempt > maxRetries) throw err
          const delay = 500 * Math.pow(2, attempt - 1)
          console.warn('[AxonExt] fetchJsonWithRetry attempt', attempt, 'failed, retrying in', delay, 'ms:', err.message)
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(tryFetch()) }, delay)
          })
        })
    }

    return tryFetch()
  }

  async function resolveFileId (evidenceId) {
    if (savedFileMap[evidenceId] && savedFileMap[evidenceId].fileId) {
      return savedFileMap[evidenceId].fileId
    }
    const savedItem = (savedEvidenceItems || []).find(function (it) { return it && it.id === evidenceId })
    const aid = (savedItem && savedItem.attributes && savedItem.attributes.domain) || agencyIdCompact || partnerIdCompact
    if (!aid) return null
    const viaDetail = await resolveFileViaEvidenceDetail(savedItem || { id: evidenceId, attributes: { domain: aid } })
    if (viaDetail && viaDetail.fileId) return viaDetail.fileId
    const evId = (evidenceId || '').replace(/-/g, '')
    const url = '/index.aspx?format=json&partner_id=' + aid + '&evidence_id=' + evId + '&withfilename=1&decodefilename=1&actionType=undefined&class=Evidence&proc=View&action=getsummary'
    try {
      const detail = await fetchJsonWithRetry(url, capturedHeaders || {}, 1)
      if (detail && detail.xml && detail.xml.evidence && detail.xml.evidence.view) {
        const view = detail.xml.evidence.view
        const files = view.files && view.files.file
        if (files) {
          const fileEntries = Array.isArray(files) ? files : [files]
          for (let i = 0; i < fileEntries.length; i++) {
            if (fileEntries[i] && fileEntries[i].file_id) {
              const fileInfo = {
                fileId: fileEntries[i].file_id,
                contentType: fileEntries[i].content_type || fileEntries[i].content_descriptor || '',
                fileName: fileEntries[i].filename || '',
                fileType: (fileEntries[i].type || '').replace(/_/g, '').replace(/^./, function (m) { return m.toUpperCase() })
              }
              savedFileMap[evidenceId] = fileInfo
              fetchedFileIds.add(evidenceId)
              const fileMap = {}
              fileMap[evidenceId] = fileInfo
              emit('file-data', { evidenceFiles: fileMap, partnerId: (aid || '').replace(/-/g, '') })
              return fileEntries[i].file_id
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AxonExt] resolveFileId on-the-fly failed for', evidenceId, e.message)
    }
    return null
  }

  // How the evidence page itself gets file IDs on my.evidence.com (see
  // my.evidence.com.har): GET /api/v3/agencies/<owning partner>/evidence/<id>
  // returns relationships.files.data with inline attributes (MasterCopy
  // first) and a per-ref partnerId. This works cross-agency for
  // shared-with-me evidence, where getsummary returns error 1060.
  function resolveFileViaEvidenceDetail (item) {
    if (!item || !item.id) return Promise.resolve(null)
    const ownerPid = ((item.attributes && item.attributes.domain) || partnerIdCompact || agencyIdCompact || '').replace(/-/g, '')
    if (!ownerPid) return Promise.resolve(null)
    const url = '/api/v3/agencies/' + ownerPid + '/evidence/' + item.id.replace(/-/g, '') + '?emitAccessEvent=false'
    return fetchJsonWithRetry(url, capturedHeaders || {}, 1)
      .then(function (detail) {
        const evidence = detail && detail.data
        let refs = evidence && evidence.relationships && evidence.relationships.files && evidence.relationships.files.data
        if (!refs) return null
        if (!Array.isArray(refs)) refs = [refs]
        let chosen = null
        for (let i = 0; i < refs.length; i++) {
          const ref = refs[i]
          if (!ref || !ref.id) continue
          if (!chosen) chosen = ref
          if (ref.attributes && ref.attributes.fileType === 'MasterCopy') { chosen = ref; break }
        }
        if (!chosen) return null
        let upByName = ''
        const upByRel = evidence && evidence.relationships && evidence.relationships.uploadedBy
        const upById = upByRel && (upByRel.id || (upByRel.data && upByRel.data.id))
        if (upById && Array.isArray(detail && detail.included)) {
          for (let ui = 0; ui < detail.included.length; ui++) {
            const inc = detail.included[ui]
            if (inc && inc.type === 'user' && inc.id === upById && inc.attributes) {
              upByName = [inc.attributes.firstName, inc.attributes.lastName].filter(Boolean).join(' ').trim()
              break
            }
          }
        }
        if (upByName) {
          item.attributes = item.attributes || {}
          item.attributes._uploadedBy = upByName
        }
        const attrs = chosen.attributes || {}
        const fileInfo = {
          fileId: chosen.id,
          contentType: attrs.contentType || attrs.contentDescriptor || '',
          fileName: attrs.fileName || '',
          fileType: attrs.fileType || '',
          uploadedBy: upByName
        }
        fetchedFileIds.add(item.id)
        savedFileMap[item.id] = fileInfo
        const fileMap = {}
        fileMap[item.id] = fileInfo
        emit('file-data', { evidenceFiles: fileMap, partnerId: (chosen.partnerId || ownerPid).replace(/-/g, '') })
        return fileInfo
      })
      .catch(function (e) {
        console.warn('[AxonExt] Evidence detail file lookup failed for', item.id, e.message)
        return null
      })
  }

  function fetchPdfPageCount (fileId, partnerId, evidenceId) {
    if (!fileId) {
      console.warn('[AxonExt] Skipping fetchPdfPageCount: missing fileId for', evidenceId)
      return Promise.resolve(null)
    }
    const fid = (fileId || '').replace(/-/g, '')
    const pid = (partnerId || '').replace(/-/g, '')
    const eid = (evidenceId || '').replace(/-/g, '')
    const url = '/api/v1/media/document/view?file_id=' + fid + '&partner_id=' + pid + '&evidence_id=' + eid

    const hdrs = {}
    if (capturedHeaders) {
      Object.keys(capturedHeaders).forEach(function (k) { hdrs[k] = capturedHeaders[k] })
    }
    delete hdrs['content-length']
    delete hdrs.host
    delete hdrs.origin
    delete hdrs.referer
    hdrs.Range = 'bytes=0-4095'

    bypassInterceptor = true
    return nativeFetch(url, { method: 'GET', headers: hdrs, credentials: capturedCredentials || 'include' })
      .then(function (resp) {
        if (resp.status === 401 || resp.status === 403) {
          const err = new Error('Auth: ' + resp.status)
          err.authError = true
          throw err
        }
        if (!resp.ok && resp.status !== 206) throw new Error('HTTP ' + resp.status)
        return resp.arrayBuffer()
      })
      .then(function (buf) {
        bypassInterceptor = false
        const bytes = new Uint8Array(buf)
        let text = ''
        for (let i = 0; i < bytes.length && i < 4096; i++) {
          text += String.fromCharCode(bytes[i])
        }
        const match = text.match(/\/N\s+(\d+)/)
        if (match) return parseInt(match[1], 10)

        const pageMatch = text.match(/\/Type\s*\/Pages[^}]*\/Count\s+(\d+)/)
        if (pageMatch) return parseInt(pageMatch[1], 10)

        return null
      })
      .catch(function (e) {
        bypassInterceptor = false
        console.warn('[AxonExt] Page count fetch failed for', eid, ':', e.message)
        return null
      })
  }

  function fetchThumbnailAsDataUrl (evidenceId, partnerId, fileId) {
    const eid = (evidenceId || '').replace(/-/g, '')
    const pid = (partnerId || '').replace(/-/g, '')
    let url
    if (fileId) {
      const fid = fileId.replace(/-/g, '')
      url = '/api/v1/media/image/transcode?file_id=' + fid + '&partner_id=' + pid + '&evidence_id=' + eid
    } else {
      url = '/api/v1/media/evidence/thumbnail?evidence_id=' + eid + '&partner_id=' + pid + '&width=197&height=132'
    }

    const hdrs = {}
    if (capturedHeaders) {
      Object.keys(capturedHeaders).forEach(function (k) { hdrs[k] = capturedHeaders[k] })
    }
    delete hdrs['content-length']
    delete hdrs.host
    delete hdrs.origin
    delete hdrs.referer

    bypassInterceptor = true
    return nativeFetch(url, { method: 'GET', headers: hdrs, credentials: capturedCredentials || 'include' })
      .then(function (resp) {
        if (resp.status === 401 || resp.status === 403) {
          const err = new Error('Auth: ' + resp.status)
          err.authError = true
          throw err
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        return resp.blob()
      })
      .then(function (blob) {
        bypassInterceptor = false
        return new Promise(function (resolve, reject) {
          const reader = new FileReader()
          reader.onloadend = function () { resolve(reader.result) }
          reader.onerror = function () { reject(new Error('FileReader error')) }
          reader.readAsDataURL(blob)
        })
      })
      .catch(function (e) {
        bypassInterceptor = false
        console.warn('[AxonExt] Thumbnail fetch failed for', eid, ':', e.message)
        return null
      })
  }

  function runPagination (baseUrlObj, firstPageData, totalPages, limit, skipOffset) {
    const endOffset = (totalPages - 1) * limit

    activeSession = {
      url: baseUrlObj.href,
      totalCount: firstPageData.meta.count,
      limit,
      totalPages,
      collected: firstPageData.data.length,
      data: firstPageData.data.slice(),
      paused: false
    }

    emit('pagination-started', {
      totalPages,
      totalCount: firstPageData.meta.count,
      collected: firstPageData.data.length
    })

    const seedExt = extractFilesFromPage(firstPageData)
    // Enrich before emitting page-data: emit() deep-clones its payload, so
    // items emitted first would be stored without _uploadedBy/_owner.
    enrichItemsWithUsers(firstPageData.data, seedExt.usersById)

    emit('page-data', {
      page: Math.floor((skipOffset || 0) / limit) + 1,
      totalPages,
      newCount: firstPageData.data.length,
      collected: firstPageData.data.length,
      totalCount: firstPageData.meta.count,
      data: firstPageData.data
    })

    if (Object.keys(seedExt.evidenceFiles).length > 0) {
      Object.keys(seedExt.evidenceFiles).forEach(function (k) { fetchedFileIds.add(k) })
      Object.assign(savedFileMap, seedExt.evidenceFiles)
      emit('file-data', { evidenceFiles: seedExt.evidenceFiles, partnerId: partnerIdCompact })
    }
    if (Object.keys(seedExt.evidenceUsers).length > 0) {
      emit('user-data', { evidenceUsers: seedExt.evidenceUsers })
    }

    const totalPagesHaveFiles = Object.keys(seedExt.evidenceFiles).length > 0

    function fetchNext (offset) {
      if (activeSession && activeSession.paused) {
        emit('pagination-paused', {
          collected: activeSession.collected,
          currentOffset: offset
        })
        return
      }
      if (!activeSession) return

      const pageNum = Math.floor(offset / limit) + 1
      emit('pagination-progress', {
        page: pageNum,
        totalPages,
        collected: activeSession.collected,
        totalCount: activeSession.totalCount
      })

      tryPage(offset, pageNum, 0)
    }

    function tryPage (offset, pageNum, attempt) {
      const pageUrl = buildPageUrl(baseUrlObj, offset)
      fetchJson(pageUrl, capturedHeaders || {})
        .then(function (pageData) {
          if (!pageData || !pageData.data || !Array.isArray(pageData.data)) {
            throw new Error('Invalid response structure')
          }

          const pageExt = extractFilesFromPage(pageData)
          if (Object.keys(pageExt.evidenceFiles).length > 0) {
            Object.keys(pageExt.evidenceFiles).forEach(function (k) { fetchedFileIds.add(k) })
            Object.assign(savedFileMap, pageExt.evidenceFiles)
            emit('file-data', { evidenceFiles: pageExt.evidenceFiles, partnerId: partnerIdCompact })
          }
          if (Object.keys(pageExt.evidenceUsers).length > 0) {
            emit('user-data', { evidenceUsers: pageExt.evidenceUsers })
          }
          enrichItemsWithUsers(pageData.data, pageExt.usersById)

          activeSession.data = activeSession.data.concat(pageData.data)
          activeSession.collected = activeSession.data.length

          emit('page-data', {
            page: pageNum,
            totalPages,
            newCount: pageData.data.length,
            collected: activeSession.collected,
            totalCount: activeSession.totalCount,
            data: pageData.data
          })

          offset += limit
          if (offset <= endOffset && activeSession && !activeSession.paused) {
            setTimeout(function () { fetchNext(offset) }, BATCH_DELAY_MS)
          } else if (activeSession && !activeSession.paused) {
            finishPagination()
          }
        })
        .catch(function (err) {
          console.warn('[AxonExt] Page fetch attempt', attempt + 1, 'failed:', err.message)
          if (attempt < 2) {
            setTimeout(function () { tryPage(offset, pageNum, attempt + 1) }, 1000 * (attempt + 1))
          } else {
            emit('pagination-error', {
              page: pageNum,
              error: err.message,
              collected: activeSession.collected
            })
            emit('pagination-stopped', {
              collected: activeSession.collected,
              totalCount: activeSession.totalCount,
              message: 'Failed to fetch page ' + pageNum + ' after 3 attempts'
            })
          }
        })
    }

    function finishPagination () {
      const deduped = deduplicate(activeSession.data)
      activeSession.data = deduped
      activeSession.collected = deduped.length

      savedEvidenceItems = deduped.slice()

      emit('pagination-complete', {
        collected: activeSession.collected,
        totalCount: activeSession.totalCount,
        data: deduped,
        baseUrl: baseUrlObj.href,
        hasFiles: totalPagesHaveFiles
      })

      activeSession = null
    }

    if (totalPages <= 1) {
      console.log('[AxonExt] Single-page collection: finishing immediately without re-fetching')
      finishPagination()
      return
    }

    const startAt = (typeof skipOffset === 'number' && skipOffset > 0) ? skipOffset : limit
    fetchNext(startAt)
  }

  function deduplicate (items) {
    const seen = {}
    return items.filter(function (item) {
      const key = item.id || (item.attributes && item.attributes.humanReadableReferenceNumber) || JSON.stringify(item)
      if (seen[key]) return false
      seen[key] = true
      return true
    })
  }

  function isOnCasePage () {
    return /\/case\//.test(window.location.href) ||
      /\/evidence-search(\/|$|\?)/.test(window.location.href)
  }

  function handleApiResponse (url, data, initHeaders) {
    console.log('[AxonExt] handleApiResponse for:', url.slice(0, 120))

    if (!isOnCasePage()) {
      console.log('[AxonExt] Not on a case page, skipping scrape setup')
      return
    }

    if (data && data.data && !data.meta) {
      const v3Match = url.match(/\/api\/v3\/agencies\/([^/?]+)\/evidence\/([^/?]+)/)
      if (v3Match) {
        const evidence = data.data
        let fileRefs = evidence.relationships && evidence.relationships.files && evidence.relationships.files.data
        if (fileRefs) {
          if (!Array.isArray(fileRefs)) fileRefs = [fileRefs]
          if (fileRefs.length > 0) {
            const pid = partnerIdCompact || (extractAgencyId(url) || '').replace(/-/g, '')
            const attrs = fileRefs[0].attributes || {}
            const fileMap = {}
            fileMap[evidence.id] = {
              fileId: fileRefs[0].id,
              contentType: attrs.contentType || '',
              fileName: attrs.fileName || '',
              fileType: attrs.fileType || ''
            }
            console.log('[AxonExt] Captured file_id from v3 detail:', fileRefs[0].id, 'for evidence:', evidence.id, 'name:', attrs.fileName)
            Object.keys(fileMap).forEach(function (k) { fetchedFileIds.add(k) })
            savedFileMap[evidence.id] = fileMap[evidence.id]
            emit('file-data', { evidenceFiles: fileMap, partnerId: pid })
          }
        }
        return
      }
    }

    console.log('[AxonExt] meta:', data && data.meta)
    console.log('[AxonExt] isArray:', Array.isArray(data && data.data), 'len:', data && data.data && data.data.length)

    if (!data || !data.meta || !data.data) {
      console.log('[AxonExt] Skipping - missing meta or data')
      emit('api-seen', { reason: 'unexpected-shape' })
      return
    }
    if (data.meta.count == null || data.meta.limit == null) {
      console.log('[AxonExt] Skipping - missing count or limit', { count: data.meta.count, limit: data.meta.limit })
      emit('api-seen', { reason: 'missing-count-or-limit' })
      return
    }

    if (data.meta.limit < 10 && data.meta.count > data.meta.limit) {
      console.log('[AxonExt] Skipping - limit too small and needs pagination:', data.meta.limit, 'count:', data.meta.count)
      return
    }

    if (!capturedHeaders) {
      capturedHeaders = extractHeaders(initHeaders)
      console.log('[AxonExt] Captured headers:', JSON.stringify(capturedHeaders).slice(0, 300))
    }

    const totalCount = data.meta.count
    // Use the site's own page size from the observed response instead of
    // forcing a larger limit: if the server caps page sizes, a forced limit
    // silently skips records (the site itself requests limit=100).
    const limit = data.meta.limit || 100
    const totalPages = Math.ceil(totalCount / limit)
    const pageOffset = data.meta.offset || 0

    console.log('[AxonExt] count:', totalCount, 'limit:', limit, 'pages:', totalPages, 'offset:', pageOffset)

    if (!activeSession) {
      let baseUrlObj
      try { baseUrlObj = new URL(url) } catch (e) { baseUrlObj = new URL(url, window.location.origin) }
      baseUrlObj.searchParams.delete('offset')
      baseUrlObj.searchParams.set('limit', String(limit))
      baseUrlObj.searchParams.set('include', 'files,uploadedBy,owner,caseAddedBy')

      agencyIdCompact = extractAgencyId(url)
      partnerIdCompact = agencyIdCompact.replace(/-/g, '')

      // Stable collection identity even when the page URL carries no
      // case/batch id (bare /axon/evidence-search route on some tenants).
      let collectionKey = null
      try { collectionKey = baseUrlObj.searchParams.get('caseId') || baseUrlObj.searchParams.get('sharedWithBatchId') || null } catch (e) { collectionKey = null }

      // A stale pending scan from an earlier SPA navigation (no reload) must
      // not suppress detection for a different case/batch — otherwise the
      // Scrape button never appears on the new page.
      if (pendingScan && pendingScan.url === baseUrlObj.href) {
        console.log('[AxonExt] Duplicate ready-to-scrape suppressed')
      } else {
        pendingScan = {
          url: baseUrlObj.href,
          baseUrlObj,
          firstPageData: data,
          totalPages,
          limit,
          pageOffset
        }

        console.log('[AxonExt] Ready to scrape', totalPages, 'pages. Awaiting user approval.')
        emit('ready-to-scrape', {
          totalPages,
          totalCount,
          collected: data.data.length,
          collectionKey
        })
      }
    } else {
      console.log('[AxonExt] Active session already exists, skipping duplicate')
    }
  }

  var nativeFetch = window.fetch

  window.fetch = function (input, init) {
    let reqUrl = ''
    try {
      reqUrl = typeof input === 'string'
        ? input
        : (input instanceof URL
            ? input.href
            : (input && input.url ? String(input.url) : String(input)))
    } catch (e) {
      reqUrl = String(input)
    }

    const isMatch = matchesEvidenceApi(reqUrl)
    const isDrawbridge = matchesDrawbridgeFolders(reqUrl)
    const isGetSummary = matchesGetSummary(reqUrl)
    console.log('[AxonExt] fetch:', reqUrl.slice(0, 120), '| match:', isMatch, '| drawbridge:', isDrawbridge, '| getsummary:', isGetSummary)

    return nativeFetch.call(window, input, init).then(function (result) {
      if (isDrawbridge && !bypassInterceptor) {
        console.log('[AxonExt] processing drawbridge response for:', reqUrl.slice(0, 120))
        try {
          const dbClone = result.clone()
          return dbClone.json().then(function (json) {
            handleDrawbridgeResponse(reqUrl, json)
            return result
          }).catch(function (e) {
            console.warn('[AxonExt] drawbridge clone.json failed:', e.message)
            return result
          })
        } catch (e) {
          console.warn('[AxonExt] drawbridge clone failed:', e.message)
          return result
        }
      }
      if (isGetSummary && !bypassInterceptor) {
        console.log('[AxonExt] processing getsummary response for:', reqUrl.slice(0, 120))
        try {
          const gsClone = result.clone()
          return gsClone.json().then(function (json) {
            handleGetSummaryResponse(reqUrl, json)
            return result
          }).catch(function (e) {
            console.warn('[AxonExt] getsummary clone.json failed:', e.message)
            return result
          })
        } catch (e) {
          console.warn('[AxonExt] getsummary clone failed:', e.message)
          return result
        }
      }
      if (isMatch && !bypassInterceptor) {
        console.log('[AxonExt] processing fetch response for:', reqUrl.slice(0, 120))
        try {
          const clone = result.clone()
          return clone.json().then(function (json) {
            handleApiResponse(reqUrl, json, init ? init.headers : undefined)
            return result
          }).catch(function (e) {
            console.warn('[AxonExt] clone.json failed:', e.message)
            return result
          })
        } catch (e) {
          console.warn('[AxonExt] clone failed:', e.message)
          return result
        }
      }
      return result
    })
  }

  const NativeXHR = window.XMLHttpRequest
  let xhrSeq = 0

  window.XMLHttpRequest = function () {
    const xhr = new NativeXHR()
    const sid = ++xhrSeq
    const originalOpen = xhr.open
    const originalSend = xhr.send
    const originalSetRequestHeader = xhr.setRequestHeader
    let reqUrl = ''
    const reqHeaders = {}
    let handled = false

    xhr.setRequestHeader = function (name, value) {
      reqHeaders[String(name).toLowerCase()] = value
      return originalSetRequestHeader.apply(xhr, arguments)
    }

    xhr.open = function (method, url) {
      reqUrl = typeof url === 'string' ? url : String(url)
      return originalOpen.apply(xhr, arguments)
    }

    xhr.send = function () {
      xhr.addEventListener('load', function () {
        if (handled) return
        const matched = matchesEvidenceApi(reqUrl)
        const dbMatch = matchesDrawbridgeFolders(reqUrl)
        const gsMatch = matchesGetSummary(reqUrl)
        console.log('[AxonExt] XHR#' + sid + ' done:', reqUrl.slice(0, 120), '| match:', matched, '| drawbridge:', dbMatch, '| getsummary:', gsMatch)
        if (!matched && !dbMatch && !gsMatch) return
        try {
          const text = xhr.responseText
          if (!text) { console.log('[AxonExt] XHR#' + sid + ' empty body'); return }
          let json
          try { json = JSON.parse(text) } catch (e) {
            console.log('[AxonExt] XHR#' + sid + ' non-json body')
            return
          }
          handled = true
          if (dbMatch) {
            console.log('[AxonExt] XHR#' + sid + ' drawbridge MATCHED, processing')
            handleDrawbridgeResponse(reqUrl, json)
          }
          if (gsMatch) {
            console.log('[AxonExt] XHR#' + sid + ' getsummary MATCHED, processing')
            handleGetSummaryResponse(reqUrl, json)
          }
          if (matched) {
            console.log('[AxonExt] XHR#' + sid + ' MATCHED, processing')
            handleApiResponse(reqUrl, json, reqHeaders)
          }
        } catch (e) {
          console.warn('[AxonExt] XHR error:', e.message)
        }
      })
      return originalSend.apply(xhr, arguments)
    }

    return xhr
  }

  Object.defineProperties(window.XMLHttpRequest, {
    UNSENT: { value: NativeXHR.UNSENT },
    OPENED: { value: NativeXHR.OPENED },
    HEADERS_RECEIVED: { value: NativeXHR.HEADERS_RECEIVED },
    LOADING: { value: NativeXHR.LOADING },
    DONE: { value: NativeXHR.DONE }
  })
  window.XMLHttpRequest.prototype = NativeXHR.prototype

  function resumePagination () {
    if (!activeSession || !activeSession.paused) return
    const offset = Math.floor(activeSession.collected / activeSession.limit) * activeSession.limit
    const startOffset = Math.max(offset, activeSession.limit)
    const endOffset = (activeSession.totalPages - 1) * activeSession.limit
    const totalPages = activeSession.totalPages
    const limit = activeSession.limit

    activeSession.paused = false

    function fetchNext (offset) {
      if (activeSession && activeSession.paused) return
      if (!activeSession) return

      const pageNum = Math.floor(offset / limit) + 1
      emit('pagination-progress', {
        page: pageNum,
        totalPages,
        collected: activeSession.collected,
        totalCount: activeSession.totalCount
      })

      tryPage(offset, pageNum, 0)
    }

    function tryPage (offset, pageNum, attempt) {
      const pageUrl = buildPageUrl(new URL(activeSession.url), offset)
      fetchJson(pageUrl, capturedHeaders || {})
        .then(function (pageData) {
          if (!pageData || !pageData.data) throw new Error('Invalid response')
          activeSession.data = activeSession.data.concat(pageData.data)
          activeSession.collected = activeSession.data.length
          emit('page-data', {
            page: pageNum,
            totalPages,
            newCount: pageData.data.length,
            collected: activeSession.collected,
            totalCount: activeSession.totalCount,
            data: pageData.data
          })
          offset += limit
          if (offset <= endOffset && activeSession && !activeSession.paused) {
            setTimeout(function () { fetchNext(offset) }, BATCH_DELAY_MS)
          } else if (activeSession && !activeSession.paused) {
            const deduped = deduplicate(activeSession.data)
            activeSession.data = deduped
            activeSession.collected = deduped.length
            savedEvidenceItems = deduped.slice()
            emit('pagination-complete', {
              collected: activeSession.collected,
              totalCount: activeSession.totalCount,
              data: deduped,
              baseUrl: activeSession.url,
              hasFiles: false
            })
            activeSession = null
          }
        })
        .catch(function (err) {
          console.warn('[AxonExt] Resume fetch attempt', attempt + 1, 'failed:', err.message)
          if (attempt < 2) {
            setTimeout(function () { tryPage(offset, pageNum, attempt + 1) }, 1000 * (attempt + 1))
          }
        })
    }

    fetchNext(startOffset)
  }

  const CONCURRENT_FETCHES = 3

  function runFileDetailFetch (resumeIndex) {
    if (!savedEvidenceItems || savedEvidenceItems.length === 0) return
    filesFetched = true

    const items = savedEvidenceItems.filter(function (item) { return item && item.id && !fetchedFileIds.has(item.id) })
    const skipped = savedEvidenceItems.length - items.length
    const total = items.length

    if (total === 0 && skipped === 0) return
    if (total === 0) {
      console.log('[AxonExt] File detail fetch: all', skipped, 'items already have files, skipping')
      emit('files-fetch-complete', { total: skipped })
      return
    }

    // On shared-with-me pages, getsummary returns error 1060 (cross-agency access denied).
    // Extract file IDs directly from the inline relationship refs instead.
    if (/\/evidence-search\/shared-with-me/.test(window.location.href)) {
      console.log('[AxonExt] Shared-with-me route: using relationship refs for file IDs, skipping getsummary')
      emit('files-fetch-started', { total: total + skipped, fetched: skipped })
      const evidenceFiles = {}
      items.forEach(function (item) {
        const fileRefs = item.relationships && item.relationships.files && item.relationships.files.data
        const refs = Array.isArray(fileRefs) ? fileRefs : (fileRefs ? [fileRefs] : [])
        if (refs.length > 0) {
          const fileId = refs[0].id
          const entry = { fileId, contentType: '', fileName: '', fileType: '' }
          // Prefer MasterCopy if available
          for (let ri = 0; ri < refs.length; ri++) {
            const info = savedFileMap[refs[ri].id] || {}
            if (info.fileType === 'MasterCopy') { entry.fileId = refs[ri].id; break }
          }
          evidenceFiles[item.id] = entry
          fetchedFileIds.add(item.id)
          savedFileMap[item.id] = entry
        }
      })
      if (Object.keys(evidenceFiles).length > 0) {
        Object.keys(evidenceFiles).forEach(function (evKey) {
          const ownerItem = items.find(function (it) { return it.id === evKey })
          const ownerPid = ((ownerItem && ownerItem.attributes && ownerItem.attributes.domain) || partnerIdCompact || '').replace(/-/g, '')
          const single = {}
          single[evKey] = evidenceFiles[evKey]
          emit('file-data', { evidenceFiles: single, partnerId: ownerPid })
        })
        emit('files-fetch-complete', { total: total + skipped })
        return
      }
      // Shared list responses carry no relationships.files refs (see
      // network-new.har), so there is nothing to extract here. Fall through
      // to getsummary below, which uses each item's owning partner instead
      // of the viewer's home agency (home agency returns error 1060).
      console.log('[AxonExt] Shared-with-me route: no inline file refs, falling back to getsummary with owning partner')
    }

    const aid = agencyIdCompact
    const startIdx = (typeof resumeIndex === 'number') ? resumeIndex : 0
    let nextIndex = startIdx
    let inFlight = 0
    let errCount = 0
    let fetched = skipped + startIdx
    let completed = false

    // One shared slot. A later fetch, pause/cancel, or auth failure can clear it
    // while other workers are still in flight — only the run that still owns it may write.
    const state = { type: 'files', id: Date.now().toString(36), items, nextIndex, fetched, total, inFlight: 0, paused: false, completed: false }
    detailTasks.files = state

    console.log('[AxonExt] Starting file detail fetch for', total, 'items (skipping', skipped, 'fetched), from index', startIdx, 'concurrency:', CONCURRENT_FETCHES)
    emit('files-fetch-started', { total: total + skipped, fetched })

    function stillCurrent () {
      return !state.completed && detailTasks.files === state
    }

    function syncState () {
      state.nextIndex = nextIndex
      state.inFlight = inFlight
      state.fetched = fetched
    }

    function tryComplete () {
      if (!stillCurrent()) return
      if (nextIndex >= total && inFlight === 0) {
        state.completed = true
        detailTasks.files = null
        console.log('[AxonExt] File detail fetch complete, got', (fetched - skipped), 'new files')
        emit('files-fetch-complete', { total: fetched })
      }
    }

    function fetchOne () {
      if (!stillCurrent()) return

      if (state.paused) {
        inFlight--
        syncState()
        emit('detail-paused', { type: 'files', index: nextIndex, fetched, total })
        tryComplete()
        return
      }

      const idx = nextIndex
      nextIndex++

      if (idx >= total) {
        inFlight--
        tryComplete()
        return
      }

      syncState()

      const item = items[idx]
      if (!item || !item.id) {
        fetched++
        state.fetched = fetched
        emit('files-fetch-progress', { fetched, total })
        fetchOne()
        return
      }

      const evId = item.id.replace(/-/g, '')
      const itemPartnerId = (item.attributes && item.attributes.domain) || aid

      // Site-proven path first (v3 evidence detail); getsummary is only a
      // fallback for tenants where the detail lookup yields no files.
      resolveFileViaEvidenceDetail(item).then(function (viaDetail) {
        if (!stillCurrent()) return
        if (viaDetail) {
          errCount = 0
          fetched++
          state.fetched = fetched
          emit('files-fetch-progress', { fetched, total })
          setTimeout(function () { fetchOne() }, 200)
          return
        }
        fetchViaGetSummary()
      })

      function fetchViaGetSummary () {
      const url = '/index.aspx?format=json&partner_id=' + itemPartnerId + '&evidence_id=' + evId + '&withfilename=1&decodefilename=1&actionType=undefined&class=Evidence&proc=View&action=getsummary'

      fetchJsonWithRetry(url, capturedHeaders || {}, 2)
        .then(function (detail) {
          errCount = 0
          if (detail && detail.xml) {
            const view = detail.xml.evidence && detail.xml.evidence.view
            let upByName = ''
            if (view && view.evidence) {
              const ev = view.evidence
              upByName = [ev.uploaded_by_first_name, ev.uploaded_by_last_name].filter(Boolean).join(' ') ||
                         ev.uploaded_by_name || ev.uploaded_by || ''
              if (upByName) {
                item.attributes = item.attributes || {}
                item.attributes._uploadedBy = upByName
              }
            }
            if (view && view.files && view.files.file) {
              const fileEntries = Array.isArray(view.files.file) ? view.files.file : [view.files.file]
              for (let fi = 0; fi < fileEntries.length; fi++) {
                const f = fileEntries[fi]
                if (!f || !f.file_id) continue
                const fileMap = {}
                fileMap[item.id] = {
                  fileId: f.file_id,
                  contentType: f.content_type || f.content_descriptor || '',
                  fileName: f.filename || '',
                  fileType: (f.type || '').replace(/_/g, '').replace(/^./, function (m) { return m.toUpperCase() }),
                  uploadedBy: upByName
                }
                fetchedFileIds.add(item.id)
                savedFileMap[item.id] = fileMap[item.id]
                emit('file-data', { evidenceFiles: fileMap, partnerId: (itemPartnerId || '').replace(/-/g, '') })
              }
            }
          }

          if (!stillCurrent()) return
          fetched++
          state.fetched = fetched
          emit('files-fetch-progress', { fetched, total })
          setTimeout(function () { fetchOne() }, 200)
        })
        .catch(function (err) {
          if (err && err.authError) {
            state.completed = true
            if (detailTasks.files === state) detailTasks.files = null
            emit('auth-error', { type: 'files', index: idx, fetched, total, error: err.message })
            return
          }
          if (!stillCurrent()) return
          console.warn('[AxonExt] File detail fetch failed for', evId, ':', err.message)
          errCount++
          fetched++
          state.fetched = fetched
          emit('files-fetch-progress', { fetched, total })
          if (errCount >= 5) {
            state.paused = true
            syncState()
            inFlight--
            state.inFlight = inFlight
            emit('detail-paused', { type: 'files', index: idx + 1, fetched, total, reason: 'Too many errors: ' + err.message })
            tryComplete()
            return
          }
          setTimeout(function () { fetchOne() }, 500 + errCount * 300)
        })
      }
    }

    const workers = Math.min(CONCURRENT_FETCHES, Math.max(0, total - startIdx))
    inFlight = workers
    state.inFlight = workers
    if (workers === 0) {
      tryComplete()
      return
    }
    for (let w = 0; w < workers; w++) {
      fetchOne()
    }
  }

  function runPageCountFetch (resumeIndex) {
    if (!savedEvidenceItems || savedEvidenceItems.length === 0) return

    const items = savedEvidenceItems.filter(function (item) {
      const ft = item.attributes && item.attributes.fileType
      return ft === 'document'
    })

    if (items.length === 0) {
      console.log('[AxonExt] No document evidence items to count pages for')
      emit('pagecount-fetch-complete', { total: 0, withCounts: 0 })
      return
    }

    const startIdx = (typeof resumeIndex === 'number') ? resumeIndex : 0
    let fetched = startIdx
    const pageCounts = {}
    let errCount = 0

    const state = { type: 'pages', id: Date.now().toString(36), items, index: startIdx, fetched, total: items.length, paused: false, completed: false }
    detailTasks.pages = state

    console.log('[AxonExt] Starting page count fetch for', items.length, 'PDF items, from index', startIdx)
    emit('pagecount-fetch-started', { total: items.length, fetched })

    function stillCurrent () {
      return !state.completed && detailTasks.pages === state
    }

    function fetchOne (index) {
      if (!stillCurrent()) return

      if (state.paused) {
        emit('detail-paused', { type: 'pages', index, fetched, total: items.length })
        return
      }

      if (index >= items.length) {
        state.completed = true
        detailTasks.pages = null
        console.log('[AxonExt] Page count fetch complete, got', Object.keys(pageCounts).length, 'counts')
        if (Object.keys(pageCounts).length > 0) {
          emit('page-counts', { pageCounts, partnerId: partnerIdCompact })
        }
        emit('pagecount-fetch-complete', { total: items.length, withCounts: Object.keys(pageCounts).length })
        return
      }

      state.index = index
      state.fetched = fetched

      const item = items[index]
      const evId = item.id
      let fi = savedFileMap[evId]
      if (!fi) {
        const fileRefs = item.relationships?.files?.data
        const refs = Array.isArray(fileRefs) ? fileRefs : (fileRefs ? [fileRefs] : [])
        if (refs.length > 0) fi = { fileId: refs[0].id }
      }
      const fileId = fi ? fi.fileId : null

      const ensureFid = fileId ? Promise.resolve(fileId) : resolveFileId(evId)
      ensureFid.then(function (resolvedId) {
        if (!stillCurrent()) return
        if (!resolvedId) {
          console.warn('[AxonExt] Cannot determine fileId for PDF page count, skipping', evId)
          fetched++
          state.fetched = fetched
          emit('pagecount-fetch-progress', { fetched, total: items.length })
          setTimeout(function () { fetchOne(index + 1) }, 100)
          return
        }
        const itemPartnerId = ((item.attributes && item.attributes.domain) || partnerIdCompact || '').replace(/-/g, '')
        return fetchPdfPageCount(resolvedId, itemPartnerId, evId)
          .then(function (count) {
            if (!stillCurrent()) return
            errCount = 0
            if (count !== null) {
              pageCounts[evId] = count
            }
            fetched++
            state.fetched = fetched
            emit('pagecount-fetch-progress', { fetched, total: items.length })
            setTimeout(function () { fetchOne(index + 1) }, 150)
          })
      }).catch(function (err) {
        if (err && err.authError) {
          state.completed = true
          if (detailTasks.pages === state) detailTasks.pages = null
          emit('auth-error', { type: 'pages', index, fetched, total: items.length, error: err.message })
          return
        }
        if (!stillCurrent()) return
        errCount++
        fetched++
        state.fetched = fetched
        emit('pagecount-fetch-progress', { fetched, total: items.length })
        if (errCount >= 5) {
          state.paused = true
          emit('detail-paused', { type: 'pages', index: index + 1, fetched, total: items.length, reason: 'Too many errors: ' + err.message })
          return
        }
        setTimeout(function () { fetchOne(index + 1) }, 500 + errCount * 500)
      })
    }

    fetchOne(startIdx)
  }

  function runThumbnailFetch (resumeIndex) {
    if (!savedEvidenceItems || savedEvidenceItems.length === 0) return

    const filtered = savedEvidenceItems.filter(function (item) {
      const ft = item.attributes && item.attributes.fileType
      return ft === 'image'
    })

    if (filtered.length === 0) {
      console.log('[AxonExt] No image evidence items to thumbnail')
      emit('thumbnail-fetch-complete', { total: 0, withThumbs: 0 })
      return
    }

    const startIdx = (typeof resumeIndex === 'number') ? resumeIndex : 0
    let fetched = startIdx
    const thumbnails = {}
    let errCount = 0

    const state = { type: 'thumbs', id: Date.now().toString(36), items: filtered, index: startIdx, fetched, total: filtered.length, paused: false, completed: false }
    detailTasks.thumbs = state

    console.log('[AxonExt] Starting thumbnail fetch for', filtered.length, 'items, from index', startIdx)
    emit('thumbnail-fetch-started', { total: filtered.length, fetched })

    function stillCurrent () {
      return !state.completed && detailTasks.thumbs === state
    }

    function fetchOne (index) {
      if (!stillCurrent()) return

      if (state.paused) {
        emit('detail-paused', { type: 'thumbs', index, fetched, total: filtered.length })
        return
      }

      if (index >= filtered.length) {
        state.completed = true
        detailTasks.thumbs = null
        console.log('[AxonExt] Thumbnail fetch complete, got', Object.keys(thumbnails).length, 'thumbnails')
        if (Object.keys(thumbnails).length > 0) {
          emit('thumbnails', { thumbnails, partnerId: partnerIdCompact })
        }
        emit('thumbnail-fetch-complete', { total: filtered.length, withThumbs: Object.keys(thumbnails).length })
        return
      }

      state.index = index
      state.fetched = fetched

      const item = filtered[index]
      const evId = item.id
      let fi = savedFileMap[evId]
      if (!fi) {
        const fileRefs = item.relationships && item.relationships.files && item.relationships.files.data
        const refs = Array.isArray(fileRefs) ? fileRefs : (fileRefs ? [fileRefs] : [])
        if (refs.length > 0) fi = { fileId: refs[0].id }
      }
      const fileId = fi ? fi.fileId : null

      const itemPartnerId = ((item.attributes && item.attributes.domain) || partnerIdCompact || '').replace(/-/g, '')
      fetchThumbnailAsDataUrl(evId, itemPartnerId, fileId)
        .then(function (dataUrl) {
          if (!stillCurrent()) return
          errCount = 0
          if (dataUrl) {
            thumbnails[evId] = dataUrl
          }
          fetched++
          state.fetched = fetched
          emit('thumbnail-fetch-progress', { fetched, total: filtered.length })
          setTimeout(function () { fetchOne(index + 1) }, 100)
        })
        .catch(function (err) {
          if (err && err.authError) {
            state.completed = true
            if (detailTasks.thumbs === state) detailTasks.thumbs = null
            emit('auth-error', { type: 'thumbs', index, fetched, total: filtered.length, error: err.message })
            return
          }
          if (!stillCurrent()) return
          errCount++
          fetched++
          state.fetched = fetched
          emit('thumbnail-fetch-progress', { fetched, total: filtered.length })
          if (errCount >= 5) {
            state.paused = true
            emit('detail-paused', { type: 'thumbs', index: index + 1, fetched, total: filtered.length, reason: 'Too many errors: ' + err.message })
            return
          }
          setTimeout(function () { fetchOne(index + 1) }, 500 + errCount * 500)
        })
    }

    fetchOne(startIdx)
  }

  function resumeDetailFetch (type) {
    if (!type || type === 'files') {
      const task = detailTasks.files
      const idx = task ? (task.nextIndex !== undefined ? task.nextIndex : 0) : 0
      if (task) task.paused = false
      runFileDetailFetch(idx)
    }
    if (!type || type === 'pages') {
      const task = detailTasks.pages
      const idx = task ? (task.index !== undefined ? task.index : 0) : 0
      if (task) task.paused = false
      runPageCountFetch(idx)
    }
    if (!type || type === 'thumbs') {
      const task = detailTasks.thumbs
      const idx = task ? (task.index !== undefined ? task.index : 0) : 0
      if (task) task.paused = false
      runThumbnailFetch(idx)
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    const msg = event.data
    if (!msg || msg.source !== 'axon-extension') return

    console.log('[AxonExt] Received command:', msg.action)

    switch (msg.action) {
      case 'start-pagination':
        if (pendingScan && !activeSession) {
          console.log('[AxonExt] User approved scrape, starting pagination')
          const ps = pendingScan
          pendingScan = null
          runPagination(ps.baseUrlObj, ps.firstPageData, ps.totalPages, ps.limit, ps.pageOffset)
        }
        break
      case 'start-files-fetch':
        if (detailTasks.files && !detailTasks.files.completed && !detailTasks.files.paused) {
          console.log('[AxonExt] Files fetch already running')
          break
        }
        if (savedEvidenceItems) runFileDetailFetch(msg.resumeIndex)
        break
      case 'start-pagecount-fetch':
        if (detailTasks.pages && !detailTasks.pages.completed && !detailTasks.pages.paused) {
          console.log('[AxonExt] Page count fetch already running')
          break
        }
        if (savedEvidenceItems) runPageCountFetch(msg.resumeIndex)
        break
      case 'start-thumbnail-fetch':
        if (detailTasks.thumbs && !detailTasks.thumbs.completed && !detailTasks.thumbs.paused) {
          console.log('[AxonExt] Thumbnail fetch already running')
          break
        }
        if (savedEvidenceItems) runThumbnailFetch(msg.resumeIndex)
        break
      case 'pause-detail':
        if (msg.detailType && detailTasks[msg.detailType]) {
          detailTasks[msg.detailType].paused = true
        } else {
          Object.keys(detailTasks).forEach(function (k) {
            if (detailTasks[k]) detailTasks[k].paused = true
          })
        }
        break
      case 'resume-detail':
        resumeDetailFetch(msg.detailType)
        break
      case 'pause-pagination':
        if (activeSession) activeSession.paused = true
        break
      case 'resume-pagination':
        resumePagination()
        break
      case 'set-state':
        if (msg.evidenceItems && msg.evidenceItems.length > 0) {
          savedEvidenceItems = msg.evidenceItems
          filesFetched = false
          if (msg.fileMap && msg.fileMap.length > 0) {
            msg.fileMap.forEach(function (f) {
              if (f && f.evidenceId) {
                savedFileMap[f.evidenceId] = f
                fetchedFileIds.add(f.evidenceId)
              }
            })
          }
          if (msg.agencyId) agencyIdCompact = msg.agencyId
          if (msg.partnerId) partnerIdCompact = msg.partnerId
          console.log('[AxonExt] Loaded state:', savedEvidenceItems.length, 'evidence items,', Object.keys(savedFileMap).length, 'files')
        }
        break
      case 'cancel-pagination':
        activeSession = null
        Object.keys(detailTasks).forEach(function (k) {
          if (detailTasks[k]) {
            detailTasks[k].paused = true
            detailTasks[k].completed = true
            detailTasks[k] = null
          }
        })
        emit('pagination-cancelled', {})
        break
      case 'get-status':
        var pagStatus = activeSession
          ? {
              active: true,
              paused: activeSession.paused,
              page: Math.floor(activeSession.collected / activeSession.limit) + 1,
              totalPages: activeSession.totalPages,
              collected: activeSession.collected,
              totalCount: activeSession.totalCount
            }
          : { active: false }
        var filesStatus = detailTasks.files && !detailTasks.files.completed
          ? { active: true, paused: detailTasks.files.paused, fetched: detailTasks.files.fetched, total: detailTasks.files.total }
          : { active: false }
        var pagesStatus = detailTasks.pages && !detailTasks.pages.completed
          ? { active: true, paused: detailTasks.pages.paused, fetched: detailTasks.pages.fetched, total: detailTasks.pages.total }
          : { active: false }
        var thumbsStatus = detailTasks.thumbs && !detailTasks.thumbs.completed
          ? { active: true, paused: detailTasks.thumbs.paused, fetched: detailTasks.thumbs.fetched, total: detailTasks.thumbs.total }
          : { active: false }
        emit('pagination-status', { pagination: pagStatus, files: filesStatus, pages: pagesStatus, thumbs: thumbsStatus })
        break
    }
  })
})()
