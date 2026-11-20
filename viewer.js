(function () {
  'use strict'

  let allData = []
  let filteredData = []
  let fileTypeFilter = null
  let deviceFilter = null
  let sortColumn = null
  let sortDir = 'asc'
  let selectedCollectionId = null
  let columns = []
  let colWidths = {}
  let visibleColumns = []
  let linkOrigin = ''
  let linkCasePath = ''
  let fileMap = {}
  let pageMap = {}
  let thumbMap = {}
  let folderMap = {}
  let galleryMode = false
  let timelineMode = false
  let folderMode = false
  let tlVideos = []
  let tlZoom = 1
  const selectedVideoIds = new Set()
  let tlPlayheadTime = null
  let tlIntervalsCache = []
  let tlLayoutCache = null
  let tlScrollCollectionId = null
  let cachedCollections = []
  let activeDropdownIndex = -1

  const searchInput = document.getElementById('search-input')
  const collectionSelect = document.getElementById('collection-select')
  const caseSelectorWrap = document.getElementById('case-selector-wrap')
  const caseSearchInput = document.getElementById('case-search-input')
  const caseSearchClear = document.getElementById('case-search-clear')
  const caseDropdownToggle = document.getElementById('case-dropdown-toggle')
  const caseDropdownList = document.getElementById('case-dropdown-list')
  const caseMatchBanner = document.getElementById('case-match-banner')
  const btnRename = document.getElementById('btn-rename')
  const tableHead = document.getElementById('table-head')
  const tableBody = document.getElementById('table-body')
  const dataTable = document.getElementById('data-table')
  const emptyState = document.getElementById('empty-state')
  const galleryView = document.getElementById('gallery-view')
  const timelineView = document.getElementById('timeline-view')
  const folderView = document.getElementById('folder-view')
  const previewEl = document.getElementById('thumbnail-preview')
  const previewImg = document.getElementById('thumbnail-preview-img')

  tableBody.addEventListener('click', function (e) {
    const img = e.target.closest('[data-slideshow]')
    if (img) { window.__axonSlideshow(img.getAttribute('data-slideshow')) }
  })
  galleryView.addEventListener('click', function (e) {
    if (e.target.closest('.gallery-src-link')) return
    const card = e.target.closest('[data-slideshow]')
    if (card) window.__axonSlideshow(card.getAttribute('data-slideshow'))
  })
  document.addEventListener('error', function (e) {
    if (e.target.tagName === 'IMG' && (e.target.closest('#table-body') || e.target.closest('#gallery-view'))) {
      e.target.style.display = 'none'
    }
  }, true)
  const statsBar = document.getElementById('stats-bar')
  const recordCount = document.getElementById('record-count')

  const FIELD_LABELS = {
    _link: 'Link',
    _thumb: '',
    _download: 'Download',
    _pages: 'Pages',
    _folder: 'Folder',
    _deviceType: 'Device',
    _deviceMount: 'Mount',
    _vehicleId: 'Vehicle',
    _deviceId: 'Device ID',
    _uploadedBy: 'Uploaded By',
    _primaryOwner: 'Primary Owner',
    title: 'Title',
    fileType: 'Type',
    status: 'Status',
    recordedOn: 'Recorded',
    uploadedOn: 'Uploaded',
    modifiedOn: 'Modified',
    duration: 'Duration',
    size: 'Size',
    sourceChannel: 'Source',
    humanReadableReferenceNumber: 'Ref#',
    contentType: 'Content Type',
    restrictionLevel: 'Restriction',
    externalId: 'External ID',
    storageTier: 'Tier',
    id: 'ID',
    sensitive: 'Sensitive',
    tags: 'Tags',
    notes: 'Notes',
    description: 'Description'
  }

  function formatValue (key, value) {
    if (value === null || value === undefined) return ''
    if (key === '_pages' && typeof value === 'number') {
      return String(value)
    }
    if (key === 'size' && typeof value === 'number') {
      if (value > 1048576) return (value / 1048576).toFixed(1) + ' MB'
      if (value > 1024) return Math.round(value / 1024) + ' KB'
      return value + ' B'
    }
    if (key === 'duration' && typeof value === 'number') {
      const m = Math.floor(value / 60); const s = Math.round(value % 60)
      return m > 0 ? m + 'm ' + s + 's' : s + 's'
    }
    if (key === '_deviceType' && value) {
      const DL = {
        axon_fleet_3_cam_dual_view: 'Fleet 3 Front',
        axon_fleet_3_cam_interior: 'Fleet 3 Interior',
        axon_fleet_3_cam_exterior: 'Fleet 3 Exterior',
        axon_fleet_3_hub: 'Fleet 3 Hub',
        axon_fleet_cam_1: 'Fleet 1',
        axon_fleet_cam_2_front: 'Fleet 2 Front',
        axon_fleet_cam_2_rear: 'Fleet 2 Rear',
        axon_body_cam_4: 'Body 4',
        axon_body_cam_5: 'Body 5',
        axon_body_cam_3: 'Body 3',
        axon_body_cam_2: 'Body 2',
        axon_body_cam_workforce: 'Body Workforce',
        axon_body_cam_workforce_mini: 'Body Mini',
        axon_flex: 'Flex',
        axon_flex_2: 'Flex 2',
        flex_pov_module: 'Flex POV',
        taser_cam: 'TASER CAM',
        taser_cam_hd: 'TASER CAM HD',
        axon_signal_sidearm_2: 'Signal Sensor',
        axon_interview: 'Interview'
      }
      return DL[value] || value.replace(/_/g, ' ').replace(/axon /i, '').replace(/\b\w/g, function (m) { return m.toUpperCase() })
    }
    if (key === '_deviceMount' && value) {
      return value.replace('MOUNT_POSITION_', '').replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase() })
    }
    if (key === 'sensitive') return value ? 'Yes' : 'No'
    if ((key === 'recordedOn' || key === 'uploadedOn' || key === 'modifiedOn') && value) {
      return new Date(value).toLocaleString()
    }
    if (Array.isArray(value)) return value.map(function (v) { return typeof v === 'object' ? JSON.stringify(v) : String(v) }).join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  function resolveFolderPath (item) {
    const folderRefs = item.relationships && item.relationships.folders && item.relationships.folders.data
    if (!folderRefs || !Array.isArray(folderRefs) || folderRefs.length === 0) return ''
    const names = []
    folderRefs.forEach(function (ref) {
      const info = folderMap[ref.id]
      if (info) {
        names.push(info.path || info.name || ref.id)
      }
    })
    return names.join('; ')
  }

  function extractFlatRecord (item) {
    const attrs = item.attributes || {}
    const evId = (item.id || '').replace(/-/g, '')
    const partnerId = (attrs.domain || '').replace(/-/g, '')
    const fi = fileMap[item.id]
    const pg = pageMap[item.id]
    let thumbUrl = ''
    if (linkOrigin && evId && attrs.fileType === 'image') {
      if (fi && fi.fileId) {
        thumbUrl = linkOrigin + '/api/v1/media/image/transcode?file_id=' + fi.fileId.replace(/-/g, '') + '&partner_id=' + partnerId + '&evidence_id=' + evId
      } else {
        thumbUrl = linkOrigin + '/api/v1/media/evidence/thumbnail?evidence_id=' + evId + '&partner_id=' + partnerId + '&width=197&height=132'
      }
    }
    const cachedThumb = thumbMap[item.id]
    if (cachedThumb) thumbUrl = cachedThumb
    const tags = attrs.tags || []
    const primaryOwners = []
    const primaryOwnerTags = []
    let deviceType = ''
    let deviceMount = ''
    let vehicleId = ''
    let deviceId = ''
    tags.forEach(function (t) {
      if (typeof t !== 'string') return
      if (t.indexOf('Original Primary Owner:') === 0) {
        const full = t.replace('Original Primary Owner:', '').trim()
        primaryOwnerTags.push(full)
        const n = full.replace(/\s*\([^)]*\)\s*$/, '').trim()
        primaryOwners.push(n)
      } else if (t.indexOf('cameraType:') === 0) {
        deviceType = t.replace('cameraType:', '').trim()
      } else if (t.indexOf('cameraMountPosition:') === 0) {
        deviceMount = t.replace('cameraMountPosition:', '').trim()
      } else if (t.indexOf('vehicleId:') === 0) {
        vehicleId = t.replace('vehicleId:', '').trim()
      }
    })
    if (!deviceType && attrs.title) {
      const tm = attrs.title.match(/Axon Body (\d+)/i)
      if (tm) deviceType = 'axon_body_cam_' + tm[1]
      else if (/Axon Flex/i.test(attrs.title)) deviceType = 'axon_flex'
      else if (/TASER/i.test(attrs.title)) deviceType = 'taser_cam'
    }
    if (!deviceMount && attrs.title) {
      if (/Front Camera/i.test(attrs.title)) deviceMount = 'MOUNT_POSITION_FRONT'
      else if (/Interior Camera/i.test(attrs.title)) deviceMount = 'MOUNT_POSITION_INTERIOR'
      else if (/Rear Camera/i.test(attrs.title)) deviceMount = 'MOUNT_POSITION_REAR'
    }
    const cd = item.relationships && item.relationships.captureDevice
    if (cd && cd.id) deviceId = cd.id
    const uploadedBy = attrs._uploadedBy || (fi && fi.uploadedBy) || ''
    let _download = ''
    if (fi && fi.fileId && linkOrigin) {
      const fid = fi.fileId.replace(/-/g, '')
      const pid = partnerId || (fi.partnerId || '').replace(/-/g, '')
      const fname = fi.fileName || attrs.title || ''
      _download = linkOrigin + '/index.aspx?class=Evidence&proc=FileGet&action=getfile&format=xml&content_disposition=attachment&file_id=' + fid + '&disposition_filename=' + encodeURIComponent(fname) + '&evidence_id=' + evId + '&partner_id=' + pid
    }
    let _videoSrc = ''
    if (fi && fi.fileId && attrs.fileType === 'video' && linkOrigin) {
      const vfid = fi.fileId.replace(/-/g, '')
      const vpid = partnerId || (fi.partnerId || '').replace(/-/g, '')
      _videoSrc = linkOrigin + '/index.aspx?class=Evidence&proc=FileGet&action=getfile&file_id=' + vfid + '&evidence_id=' + evId + '&partner_id=' + vpid
    }
    return {
      _link: linkOrigin && evId ? (linkOrigin + '/axon/evidence?evidence_id=' + evId + '&partner_id=' + partnerId) : '#',
      _download,
      _videoSrc,
      _thumb: thumbUrl,
      _hasDetail: !!(fi && fi.fileId),
      _primaryOwner: primaryOwners.join(', '),
      _primaryOwners: primaryOwnerTags,
      _pages: pg || '',
      _folder: resolveFolderPath(item),
      _deviceType: deviceType,
      _deviceMount: deviceMount,
      _deviceId: deviceId,
      _vehicleId: vehicleId,
      _uploadedBy: uploadedBy,
      id: item.id,
      title: attrs.title || '',
      fileType: attrs.fileType || '',
      status: attrs.status || '',
      recordedOn: attrs.recordedOn || '',
      uploadedOn: attrs.uploadedOn || '',
      modifiedOn: attrs.modifiedOn || '',
      duration: attrs.duration,
      size: attrs.size,
      sourceChannel: attrs.sourceChannel || '',
      humanReadableReferenceNumber: attrs.humanReadableReferenceNumber || '',
      contentType: attrs.contentType || '',
      restrictionLevel: attrs.restrictionLevel,
      externalId: attrs.externalId || '',
      storageTier: attrs.storageTier || '',
      sensitive: attrs.sensitive,
      tags: attrs.tags || [],
      notes: attrs.notes || '',
      description: attrs.description || ''
    }
  }

  // A shared evidence item carries one 'Original Primary Owner:' tag per
  // owner in its share chain (camera officer, then prosecutor, ...), in no
  // reliable order. The camera owner is the listed owner whose name matches
  // the item's uploadedBy user ('First Last' vs the tag's 'Last, First'), so
  // owner identity must be resolved by that match — never by taking the
  // first tag, and never by splitting a name on ',' (that yields only a
  // surname, e.g. 'Harvey' from the first share-chain owner).
  function ownerPersonKey (name) {
    if (!name) return ''
    const clean = String(name).replace(/\s*\([^)]*\)\s*$/, '').trim()
    let first = ''
    let last = ''
    if (clean.indexOf(',') >= 0) {
      const parts = clean.split(',')
      last = (parts[0] || '').trim()
      first = ((parts[1] || '').trim().split(/\s+/)[0] || '')
    } else {
      const parts = clean.split(/\s+/).filter(Boolean)
      first = parts[0] || ''
      last = parts.length > 1 ? parts[parts.length - 1] : ''
    }
    return (first + ' ' + last).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  }

  function titleSerialFor (title) {
    const m = String(title || '').trim().match(/([A-Za-z]\d[A-Za-z0-9]{6,})\s*$/)
    return m ? m[1].toUpperCase() : ''
  }

  function deviceIdentityFor (v) {
    if (!v) return ''
    if (v._deviceId) return v._deviceId
    const serial = titleSerialFor(v.title)
    if (serial) return 'serial:' + serial
    if (v._vehicleId) return v._vehicleId
    return ''
  }

  // Full lane-owner label for a record (e.g. 'Bruce, Gino (1944)'), or ''
  // when the owner cannot be told apart. deviceOwnerByIdentity optionally
  // maps deviceIdentityFor() values to labels resolved from other videos
  // of the same physical device, which share this video's camera owner.
  function resolveOwnerName (v, deviceOwnerByIdentity) {
    if (!v) return ''
    const owners = (Array.isArray(v._primaryOwners) && v._primaryOwners.length)
      ? v._primaryOwners
      : (v._primaryOwner ? [v._primaryOwner] : [])
    const upKey = ownerPersonKey(v._uploadedBy)
    if (owners.length) {
      if (upKey) {
        const match = owners.find(function (o) { return ownerPersonKey(o) === upKey })
        if (match) return match
        return String(v._uploadedBy).trim()
      }
      if (owners.length === 1) return owners[0]
      if (deviceOwnerByIdentity) {
        const mapped = deviceOwnerByIdentity[deviceIdentityFor(v)]
        if (mapped) {
          const mk = ownerPersonKey(mapped)
          const match = owners.find(function (o) { return ownerPersonKey(o) === mk })
          if (match) return match
        }
      }
      return ''
    }
    if (v._uploadedBy) return String(v._uploadedBy).trim()
    if (deviceOwnerByIdentity) {
      return deviceOwnerByIdentity[deviceIdentityFor(v)] || ''
    }
    return ''
  }

  function buildDeviceOwnerMap (records) {
    const deviceOwnerVotes = {}
    ;(records || []).forEach(function (r) {
      const id = deviceIdentityFor(r)
      const owner = resolveOwnerName(r)
      if (!id || !owner) return
      if (!deviceOwnerVotes[id]) deviceOwnerVotes[id] = {}
      const k = ownerPersonKey(owner) || owner.toLowerCase()
      if (!deviceOwnerVotes[id][k]) deviceOwnerVotes[id][k] = { label: owner, count: 0 }
      deviceOwnerVotes[id][k].count++
    })
    const deviceOwnerByIdentity = {}
    Object.keys(deviceOwnerVotes).forEach(function (id) {
      const votes = deviceOwnerVotes[id]
      const top = Object.keys(votes).sort(function (a, b) { return votes[b].count - votes[a].count })[0]
      if (top) deviceOwnerByIdentity[id] = votes[top].label
    })
    return deviceOwnerByIdentity
  }

  function deviceBadgeBucketFor (r, deviceOwnerByIdentity) {
    if (!r) return null
    const raw = r._deviceId || r._vehicleId || r._deviceType || ''
    if (!raw) return null
    const owner = resolveOwnerName(r, deviceOwnerByIdentity)
    if (owner) {
      const pk = ownerPersonKey(owner) || owner.toLowerCase()
      const shortName = String(owner).replace(/\s*\([^)]*\)\s*$/, '').trim() || owner
      return { key: 'person:' + pk, label: shortName, hasComma: shortName.indexOf(',') >= 0 }
    }
    const typeName = r._deviceType ? formatValue('_deviceType', r._deviceType) : ''
    const isSpecific = raw === r._deviceId || raw === r._vehicleId
    const label = isSpecific
      ? (typeName || raw.slice(0, 8) + '\u2026')
      : (typeName || formatValue('_deviceType', raw) || raw.slice(0, 8) + '\u2026')
    return { key: raw, label: label, hasComma: false }
  }

  function matchesDeviceFilter (r, filterKey, deviceOwnerByIdentity) {
    if (!filterKey) return true
    if (filterKey.indexOf('person:') === 0) {
      if (!(r._deviceId || r._vehicleId || r._deviceType)) return false
      const owner = resolveOwnerName(r, deviceOwnerByIdentity)
      if (!owner) return false
      return ('person:' + (ownerPersonKey(owner) || owner.toLowerCase())) === filterKey
    }
    return r._deviceType === filterKey || r._deviceId === filterKey || r._vehicleId === filterKey
  }

  const DEFAULT_VISIBLE_COLUMNS = [
    '_thumb',
    '_link',
    '_primaryOwner',
    '_pages',
    '_folder',
    '_uploadedBy',
    'title',
    'fileType',
    'recordedOn',
    'uploadedOn',
    'modifiedOn',
    'duration',
    'size'
  ]

  function detectColumns () {
    if (allData.length === 0) return []
    const first = allData[0]
    const excludeFromBase = [
      '_raw', '_hasDetail', '_videoSrc', '_primaryOwners',
      '_deviceId', '_vehicleId',
      '_thumb', '_link', '_download', '_pages', '_folder',
      '_deviceType', '_deviceMount',
      '_primaryOwner', '_uploadedBy',
      'title', 'fileType', 'recordedOn', 'uploadedOn', 'modifiedOn', 'duration', 'size'
    ]
    const keys = []
    const showThumb = allData.some(function (r) { return r.fileType === 'image' })
    if (showThumb) keys.push('_thumb')
    if (first._link || allData.some(function (r) { return r._link })) keys.push('_link')

    if ('_primaryOwner' in first || allData.some(function (r) { return r._primaryOwner })) {
      keys.push('_primaryOwner')
    }

    const showPages = allData.some(function (r) { return r.fileType === 'document' && r.contentType === 'application/pdf' })
    if (showPages) keys.push('_pages')

    const showFolders = allData.some(function (r) { return r._folder })
    if (showFolders) keys.push('_folder')

    if ('_uploadedBy' in first || allData.some(function (r) { return r._uploadedBy })) {
      keys.push('_uploadedBy')
    }

    const defaultMeta = ['title', 'fileType', 'recordedOn', 'uploadedOn', 'modifiedOn', 'duration', 'size']
    defaultMeta.forEach(function (k) {
      if (k in first || allData.some(function (r) { return k in r })) {
        keys.push(k)
      }
    })

    const showDevices = allData.some(function (r) { return r._deviceType || r._deviceId })
    if (showDevices) keys.push('_deviceType', '_deviceMount')

    Object.keys(first).forEach(function (k) {
      if (excludeFromBase.indexOf(k) === -1 && keys.indexOf(k) === -1) {
        keys.push(k)
      }
    })

    const showDownload = allData.some(function (r) { return r._download })
    if (showDownload && keys.indexOf('_download') === -1) keys.push('_download')

    const seen = {}
    const unique = []
    keys.forEach(function (col) {
      if (!seen[col]) {
        seen[col] = true
        unique.push(col)
      }
    })
    return unique
  }

  function toggleColumn (col) {
    const idx = visibleColumns.indexOf(col)
    if (idx >= 0) { visibleColumns.splice(idx, 1) } else { visibleColumns.splice(columns.indexOf(col), 0, col) }
    visibleColumns.sort(function (a, b) { return columns.indexOf(a) - columns.indexOf(b) })
    doRender()
    buildColumnDropdown()
  }

  function buildColumnDropdown () {
    const dd = document.getElementById('column-dropdown')
    dd.innerHTML = columns.map(function (col) {
      const label = FIELD_LABELS[col] || col
      const checked = visibleColumns.indexOf(col) >= 0
      return '<label><input type="checkbox" ' + (checked ? 'checked' : '') + ' data-col="' + col + '">' + (label || col || '(empty)') + '</label>'
    }).join('')
    dd.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () { toggleColumn(this.dataset.col) })
    })
  }

  function searchData (term) {
    let source = allData
    if (fileTypeFilter) {
      source = source.filter(function (r) { return (r.fileType || 'unknown') === fileTypeFilter })
    }
    if (deviceFilter) {
      const deviceOwnerByIdentity = buildDeviceOwnerMap(allData)
      source = source.filter(function (r) { return matchesDeviceFilter(r, deviceFilter, deviceOwnerByIdentity) })
    }
    if (!term) { filteredData = source.slice(); return }
    const tokens = term.toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) { filteredData = source.slice(); return }
    filteredData = source.filter(function (row) {
      return tokens.every(function (token) {
        return Object.values(row).some(function (val) {
          if (val === null || val === undefined) return false
          return String(val).toLowerCase().indexOf(token) !== -1
        })
      })
    })
  }

  function sortData (col) {
    if (sortColumn === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    else { sortColumn = col; sortDir = 'asc' }
    filteredData.sort(function (a, b) {
      let va = a[col]; let vb = b[col]
      if (va === null || va === undefined) va = ''
      if (vb === null || vb === undefined) vb = ''
      if (col === 'recordedOn' || col === 'uploadedOn' || col === 'modifiedOn') {
        va = new Date(va).getTime() || 0; vb = new Date(vb).getTime() || 0
      } else if (col === '_pages') {
        va = Number(va) || 0; vb = Number(vb) || 0
      } else if (typeof va === 'number') { vb = Number(vb) || 0 } else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase() }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  function renderTable () {
    const cols = visibleColumns.length > 0 ? visibleColumns : columns
    tableHead.innerHTML = '<tr>' + cols.map(function (col) {
      const label = FIELD_LABELS[col] || col
      const arrow = sortColumn === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''
      const w = colWidths[col] ? ' style="width:' + colWidths[col] + 'px;"' : ''
      return '<th data-col="' + col + '" class="sortable" draggable="true"' + w + '>' +
        '<span class="th-label">' + label + arrow + '</span>' +
        '<span class="col-resize-handle"></span></th>'
    }).join('') + '</tr>'

    tableBody.innerHTML = filteredData.map(function (row) {
      return '<tr>' + cols.map(function (col) {
        if (col === '_thumb') {
          if (!row._thumb) return '<td></td>'
          const url = row._thumb || ''
          if (url) {
            const hasDetails = url.indexOf('transcode') >= 0 || url.indexOf('data:') === 0
            const border = url.indexOf('data:') === 0 ? 'border:2px solid #22c55e;' : (hasDetails ? 'border:2px solid #38bdf8;' : '')
            return '<td style="padding:2px;"><img src="' + escAttr(url) + '" data-slideshow="' + escAttr(url) + '" style="width:40px;height:40px;object-fit:cover;border-radius:4px;cursor:pointer;' + border + '" loading="lazy" title="' + (row.title ? escAttr(row.title) : '') + (url.indexOf('data:') === 0 ? ' (cached)' : '') + '"></td>'
          }
          return '<td style="padding:2px;"><div style="width:40px;height:40px;border-radius:4px;background:#334155;display:flex;align-items:center;justify-content:center;" title="No file_id captured yet"><span style="color:#64748b;font-size:18px;">&#128247;</span></div></td>'
        }
        if (col === '_link') {
          let linkHtml = '<a href="' + escAttr(row[col]) + '" target="_blank" style="color:#38bdf8;text-decoration:none;" title="Open on evidence.com">\u2197</a>'
          if (row._download) {
            linkHtml += ' <a href="' + escAttr(row._download) + '" title="Download file" style="color:#86efac;text-decoration:none;margin-left:2px;">\u2B07</a>'
          }
          return '<td>' + linkHtml + '</td>'
        }
        if (col === '_download') {
          if (!row._download) return '<td style="color:#64748b;">—</td>'
          return '<td><a href="' + escAttr(row._download) + '" target="_blank" style="color:#86efac;text-decoration:none;" title="Download file">\u2B07 Download</a></td>'
        }
        const val = escapeHtml(formatValue(col, row[col]))
        return '<td title="' + escAttr(formatValue(col, row[col])) + '">' + val + '</td>'
      }).join('') + '</tr>'
    }).join('')

    const ths = document.querySelectorAll('#table-head th.sortable')
    ths.forEach(function (th) {
      th.addEventListener('click', function () { sortData(this.dataset.col); doRender() })
    })
    tableBody.style.display = filteredData.length === 0 ? 'none' : ''
    setupResize()
    setupDragDrop()
  }

  function renderGallery () {
    dataTable.style.display = 'none'
    tableHead.style.display = 'none'
    emptyState.style.display = filteredData.length === 0 ? '' : 'none'
    galleryView.style.display = filteredData.length === 0 ? 'none' : ''

    const images = filteredData.filter(function (r) { return r._thumb })

    galleryView.innerHTML = images.map(function (r) {
      const srcLink = (r._link && r._link !== '#') ? '<a href="' + escAttr(r._link) + '" class="gallery-src-link" target="_blank" title="Open in Evidence.com">&#8599;</a>' : ''
      return '<div class="gallery-card" data-slideshow="' + escAttr(r._thumb) + '" title="' + escAttr(r.title || '') + '">' +
        '<img src="' + escAttr(r._thumb) + '" class="gallery-img" loading="lazy">' +
        srcLink +
        '<div class="gallery-label">' + escapeHtml(r.title || r.id) + '</div>' +
      '</div>'
    }).join('')

    if (images.length === 0 && filteredData.length > 0) {
      galleryView.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;">No images with thumbnails in this collection.</div>'
    }
  }

  function computeConcurrencyBuckets (intervals, firstTs, lastTs, numBuckets) {
    const span = Math.max(1000, lastTs - firstTs)
    const buckets = new Array(numBuckets).fill(0)
    let maxConcurrent = 0
    for (let b = 0; b < numBuckets; b++) {
      const bStart = firstTs + (b / numBuckets) * span
      const bEnd = firstTs + ((b + 1) / numBuckets) * span
      const mid = (bStart + bEnd) / 2
      let count = 0
      for (let i = 0; i < intervals.length; i++) {
        const iv = intervals[i]
        if (iv.start <= mid && iv.end >= mid) {
          count++
        } else if (iv.start < bEnd && iv.end > bStart) {
          count++
        }
      }
      buckets[b] = count
      if (count > maxConcurrent) maxConcurrent = count
    }
    return { buckets: buckets, maxConcurrent: maxConcurrent }
  }

  function countVideosAtTime (intervals, ts) {
    let count = 0
    for (let i = 0; i < intervals.length; i++) {
      if (intervals[i].start <= ts && intervals[i].end >= ts) count++
    }
    return count
  }

  function formatRealClock (ts, includeDate) {
    if (!ts || isNaN(ts)) return '--:--:--'
    const d = new Date(ts)
    const timeStr = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
    if (includeDate) {
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return dateStr + ' ' + timeStr
    }
    return timeStr
  }

  function renderTimeline () {
    // The whole #tl-scroll subtree is rebuilt below. Remember the viewport
    // offsets so toggling a bar (which re-renders for the checkmark/state)
    // does not snap the timeline back to its beginning. A new collection
    // still starts at the left edge.
    const keepScroll = timelineView.style.display !== 'none' && tlScrollCollectionId === selectedCollectionId
    const prevScrollEl = keepScroll ? document.getElementById('tl-scroll') : null
    const prevScrollLeft = prevScrollEl ? prevScrollEl.scrollLeft : 0
    const prevScrollTop = prevScrollEl ? prevScrollEl.scrollTop : 0

    dataTable.style.display = 'none'
    tableHead.style.display = 'none'
    emptyState.style.display = 'none'
    galleryView.style.display = 'none'
    timelineView.style.display = ''

    const videos = filteredData.filter(function (r) { return r.fileType === 'video' && r.recordedOn })
    tlVideos = videos
    if (videos.length === 0) {
      timelineView.innerHTML = '<div style="padding:60px;text-align:center;color:#64748b;">No videos with timestamps in this collection.</div>'
      return
    }

    // Sort by start time
    videos.sort(function (a, b) { return new Date(a.recordedOn) - new Date(b.recordedOn) })

    // Convert to intervals: { start: ms, end: ms, video: record }
    const intervals = videos.map(function (v) {
      const s = new Date(v.recordedOn).getTime()
      return { start: s, end: s + (v.duration || 0) * 1000, video: v }
    })
    tlIntervalsCache = intervals

    // Lane = one owner (aka uploader), resolved by resolveOwnerName: the
    // 'Original Primary Owner' tag matching _uploadedBy, not the first tag
    // or a surname fragment. Videos of a device whose owner was resolved
    // from a sibling video (same capture device / title serial) inherit
    // that owner. Videos with no resolvable person fall back to their
    // device identity, and videos with neither land in a single Unknown
    // lane — they are never merged into a named person's lane.
    const deviceOwnerByIdentity = buildDeviceOwnerMap( allData && allData.length ? allData : videos )

    function uploaderKeyFor (v) {
      const name = resolveOwnerName(v, deviceOwnerByIdentity)
      if (name) return { key: 'person:' + (ownerPersonKey(name) || name.toLowerCase()), label: name }
      const raw = v._deviceId || v._vehicleId || v._deviceType || ''
      if (raw) {
        const typeName = v._deviceType ? formatValue('_deviceType', v._deviceType) : ''
        return { key: 'device:' + raw, label: typeName || raw.slice(0, 8) + '\u2026' }
      }
      return { key: 'unknown', label: 'Unknown' }
    }

    function deviceKeyFor (v) {
      if (v._deviceMount) {
        const raw = v._deviceId || v._vehicleId || v._deviceType || 'dev'
        return raw + ':' + v._deviceMount
      }
      if (v._deviceType) {
        const raw = v._deviceId || v._vehicleId || ''
        return raw ? (raw + ':' + v._deviceType) : v._deviceType
      }
      return v._deviceId || v._vehicleId || 'unknown'
    }

    // Body-worn cameras read before fleet cameras, so in a multi-channel
    // lane the body channel is conventionally the top sub-row, followed
    // by fleet front, fleet interior, etc.
    function deviceRankFor (v) {
      const t = ((v._deviceType || '') + ' ' + (v.title || '') + ' ' + (v._deviceMount || '')).toLowerCase()
      if (t.indexOf('body') >= 0 || t.indexOf('flex') >= 0) return 0
      if (t.indexOf('front') >= 0) return 1
      if (t.indexOf('interior') >= 0) return 2
      if (t.indexOf('fleet') >= 0 || v._vehicleId) return 3
      if (t.indexOf('taser') >= 0) return 4
      if (t.indexOf('interview') >= 0) return 5
      if (t.trim()) return 6
      return 7
    }

    function deviceKindFor (v) {
      const t = ((v._deviceType || '') + ' ' + (v.title || '')).toLowerCase()
      if (t.indexOf('fleet') >= 0 || v._vehicleId) return 'fleet'
      if (t.indexOf('body') >= 0 || t.indexOf('flex') >= 0) return 'body'
      if (t.indexOf('taser') >= 0) return 'taser'
      if (t.indexOf('interview') >= 0) return 'interview'
      return 'other'
    }

    function deviceLabelFor (v, dk) {
      if (v._deviceType) return formatValue('_deviceType', v._deviceType)
      if (v._deviceMount) return formatValue('_deviceMount', v._deviceMount)
      if (v.title && /Axon Body (\d+)/i.test(v.title)) return 'Body ' + RegExp.$1
      if (v.title && /Axon Fleet (\d+)/i.test(v.title)) return 'Fleet ' + RegExp.$1
      if (dk && dk !== 'unknown') return dk.slice(0, 8) + '\u2026'
      return 'Upload'
    }

    // Group intervals into one lane per uploader.
    const laneByKey = {}
    const laneList = []
    intervals.forEach(function (iv) {
      const up = uploaderKeyFor(iv.video)
      let lane = laneByKey[up.key]
      if (!lane) {
        lane = { key: up.key, label: up.label, items: [], deviceLabels: {}, deviceKeys: [], earliestStart: Infinity }
        laneByKey[up.key] = lane
        laneList.push(lane)
      }
      lane.items.push(iv)
      if (iv.start < lane.earliestStart) {
        lane.earliestStart = iv.start
      }
      const dk = deviceKeyFor(iv.video)
      if (dk && !lane.deviceLabels[dk]) {
        lane.deviceLabels[dk] = deviceLabelFor(iv.video, dk)
        lane.deviceKeys.push(dk)
      }
    })

    // Sort lanes chronologically: earliest video first at the top,
    // descending to the latest video down the line.
    laneList.sort(function (a, b) {
      if (a.earliestStart !== b.earliestStart) {
        return a.earliestStart - b.earliestStart
      }
      if (a.key === 'unknown') return 1
      if (b.key === 'unknown') return -1
      return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : (a.label.toLowerCase() > b.label.toLowerCase() ? 1 : 0)
    })

    // Sub-row packing inside each lane:
    // A lane stacks by device (e.g. Body Cam on top, Fleet Cam below it) so each
    // uploader's streams have consistent horizontal channels across time.
    // An additional sub-row is only added if multiple simultaneous clips from the
    // same device overlap in time.
    laneList.forEach(function (lane) {
      const deviceKeys = []
      const deviceSeen = {}
      lane.items.forEach(function (iv) {
        const dk = deviceKeyFor(iv.video)
        if (!deviceSeen[dk]) {
          deviceSeen[dk] = true
          deviceKeys.push(dk)
        }
      })

      // Sort device channels: Body cameras first, then Fleet Front, Fleet Interior, etc.
      deviceKeys.sort(function (da, db) {
        const itemA = lane.items.find(function (iv) { return deviceKeyFor(iv.video) === da })
        const itemB = lane.items.find(function (iv) { return deviceKeyFor(iv.video) === db })
        const rankDiff = deviceRankFor(itemA.video) - deviceRankFor(itemB.video)
        if (rankDiff !== 0) return rankDiff
        return itemA.start - itemB.start
      })

      // Reserve base channel (1 sub-row per distinct device)
      const subRows = []
      const baseRowForDevice = {}
      deviceKeys.forEach(function (dk, idx) {
        baseRowForDevice[dk] = idx
        const repItem = lane.items.find(function (iv) { return deviceKeyFor(iv.video) === dk })
        const label = deviceLabelFor(repItem.video, dk)
        subRows[idx] = { end: 0, deviceKey: dk, label: label }
      })

      // Sort items by start time
      lane.items.sort(function (a, b) {
        return (a.start - b.start) || (deviceRankFor(a.video) - deviceRankFor(b.video))
      })

      lane.items.forEach(function (iv) {
        const dk = deviceKeyFor(iv.video)
        const preferredRow = baseRowForDevice[dk]

        if (subRows[preferredRow].end <= iv.start) {
          subRows[preferredRow].end = iv.end
          iv.subRow = preferredRow
          return
        }

        // Clip overlaps on this device's base row: find an existing overflow row for this device
        let placedRow = -1
        for (let r = deviceKeys.length; r < subRows.length; r++) {
          if (subRows[r].deviceKey === dk && subRows[r].end <= iv.start) {
            placedRow = r
            break
          }
        }
        if (placedRow === -1) {
          for (let r = deviceKeys.length; r < subRows.length; r++) {
            if (subRows[r].end <= iv.start) {
              placedRow = r
              subRows[r].deviceKey = dk
              break
            }
          }
        }
        if (placedRow === -1) {
          const repLabel = deviceLabelFor(iv.video, dk)
          subRows.push({ end: iv.end, deviceKey: dk, label: repLabel })
          placedRow = subRows.length - 1
        } else {
          subRows[placedRow].end = iv.end
        }
        iv.subRow = placedRow
      })

      lane.subRowCount = Math.max(1, subRows.length)
      lane.subRowLabels = subRows.map(function (sr) { return sr.label })
    })

    const numLanes = laneList.length
    const SUB_H = 26
    const SUB_GAP = 2
    const LANE_PAD_TOP = 4
    const LANE_PAD_BOTTOM = 4
    const LANE_PAD = LANE_PAD_TOP + LANE_PAD_BOTTOM
    const LABEL_W = 200
    const PADDING = 16
    const AXIS_H = 42
    const DENSITY_H = 34
    const HEADER_TOP = AXIS_H + DENSITY_H
    const MIN_BAR_W = 4

    // Lane tops are cumulative: taller (multi-channel) lanes push the
    // lanes below them down.
    let laneCursor = HEADER_TOP
    laneList.forEach(function (lane) {
      lane.top = laneCursor
      lane.height = lane.subRowCount * SUB_H + (lane.subRowCount - 1) * SUB_GAP + LANE_PAD
      laneCursor += lane.height
    })

    const firstTs = intervals[0].start
    let lastTs = intervals[0].end
    intervals.forEach(function (iv) { if (iv.end > lastTs) lastTs = iv.end })
    const totalSpan = Math.max(1, (lastTs - firstTs) / 1000)

    if (tlPlayheadTime === null || tlPlayheadTime < firstTs || tlPlayheadTime > lastTs) {
      tlPlayheadTime = firstTs
    }

    const startDate = new Date(firstTs)
    const endDate = new Date(lastTs)
    const isSameDay = startDate.toDateString() === endDate.toDateString()
    const dateRangeStr = isSameDay
      ? startDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' \u2013 ' + endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    const timeSpanStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) +
      ' \u2013 ' + endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

    // Base scale: aim for ~4px per second, then apply user zoom
    let basePxPerSec = 4
    if (totalSpan > 7200) basePxPerSec = 2
    if (totalSpan > 14400) basePxPerSec = 1
    if (totalSpan > 43200) basePxPerSec = 0.5
    const pxPerSec = basePxPerSec * tlZoom

    const canvasW = LABEL_W + totalSpan * pxPerSec + PADDING * 2
    const canvasH = laneCursor + PADDING

    tlLayoutCache = {
      firstTs: firstTs,
      lastTs: lastTs,
      totalSpan: totalSpan,
      pxPerSec: pxPerSec,
      labelW: LABEL_W,
      headerTop: HEADER_TOP,
      canvasH: canvasH,
      isSameDay: isSameDay
    }

    // Concurrency density histogram across the timeline
    const spanPx = Math.max(60, Math.round(totalSpan * pxPerSec))
    const numBuckets = Math.min(400, Math.max(40, Math.floor(spanPx / 6)))
    const concurrencyData = computeConcurrencyBuckets(intervals, firstTs, lastTs, numBuckets)
    const maxConcurrent = concurrencyData.maxConcurrent
    const bucketW = (totalSpan * pxPerSec) / numBuckets
    let densityBarsHtml = ''
    for (let b = 0; b < numBuckets; b++) {
      const cnt = concurrencyData.buckets[b]
      if (cnt <= 0) continue
      const hPct = Math.max(15, Math.round((cnt / Math.max(1, maxConcurrent)) * 100))
      const bLeft = LABEL_W + b * bucketW
      const bStartTs = firstTs + (b / numBuckets) * (lastTs - firstTs)
      const bTimeLabel = formatRealClock(bStartTs, !isSameDay)
      const heatClass = cnt >= 4 ? 'tl-density-bar-hot' : (cnt >= 2 ? 'tl-density-bar-multi' : 'tl-density-bar-single')
      densityBarsHtml += '<div class="tl-density-bar ' + heatClass + '" style="left:' + bLeft.toFixed(1) + 'px;width:' + Math.max(1.5, bucketW - 0.5).toFixed(1) + 'px;height:' + hPct + '%;" data-ts="' + Math.round(bStartTs) + '" title="' + escAttr(cnt + (cnt === 1 ? ' video active at ' : ' videos simultaneously active at ') + bTimeLabel + ' (Click to queue playhead here)') + '"></div>'
    }

    const densityLaneHtml = '<div class="tl-density-row" style="top:' + AXIS_H + 'px;height:' + DENSITY_H + 'px;">' +
      '<div class="tl-density-corner" style="width:' + LABEL_W + 'px;height:' + DENSITY_H + 'px;" title="Shows how many videos are simultaneously recorded at each real point in time. Click anywhere to move the master playhead.">' +
        '<span class="tl-density-title">Simultaneous Videos</span>' +
        '<span class="tl-density-peak">Peak: ' + maxConcurrent + ' active</span>' +
      '</div>' +
      '<div class="tl-density-track">' + densityBarsHtml + '</div>' +
    '</div>'

    // Time axis ticks & date markers
    // Candidate intervals in seconds: from 10s up to 24h
    const candidateIntervals = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400]
    let tickInterval = 60
    const targetSec = 110 / pxPerSec
    for (let i = 0; i < candidateIntervals.length; i++) {
      if (candidateIntervals[i] >= targetSec) {
        tickInterval = candidateIntervals[i]
        break
      }
      if (i === candidateIntervals.length - 1) {
        tickInterval = candidateIntervals[i]
      }
    }

    const firstTick = Math.ceil(firstTs / (tickInterval * 1000)) * (tickInterval * 1000)
    const startTick = firstTick <= lastTs ? firstTick : firstTs
    let axisTicks = ''
    let gridLines = ''
    let lastDateKey = ''

    for (let tick = startTick; tick <= lastTs; tick += tickInterval * 1000) {
      const offset = LABEL_W + ((tick - firstTs) / 1000) * pxPerSec
      const d = new Date(tick)
      const dateKey = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
      const isNewDay = dateKey !== lastDateKey
      if (isNewDay) lastDateKey = dateKey

      const timeStr = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: tickInterval < 60 ? '2-digit' : undefined,
        hour12: true
      })
      const fullDateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

      if (isNewDay) {
        const dateBadge = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        axisTicks += '<div class="tl-tick tl-tick-day" style="left:' + offset + 'px;" title="' + escAttr(fullDateStr + ' ' + timeStr) + '">' +
          '<span class="tl-tick-date">' + escapeHtml(dateBadge) + '</span>' +
          '<span class="tl-tick-time">' + escapeHtml(timeStr) + '</span>' +
          '<span class="tl-tick-notch tl-tick-notch-day"></span>' +
        '</div>'
        if (tick > startTick) {
          gridLines += '<div class="tl-day-divider" style="left:' + offset + 'px;top:' + HEADER_TOP + 'px;" title="' + escAttr(fullDateStr) + '"></div>'
        }
      } else {
        axisTicks += '<div class="tl-tick" style="left:' + offset + 'px;" title="' + escAttr(fullDateStr + ' ' + timeStr) + '">' +
          '<span class="tl-tick-time">' + escapeHtml(timeStr) + '</span>' +
          '<span class="tl-tick-notch"></span>' +
        '</div>'
        gridLines += '<div class="tl-grid-line" style="left:' + offset + 'px;top:' + HEADER_TOP + 'px;"></div>'
      }
    }

    const axisCorner = '<div class="tl-axis-corner" style="width:' + LABEL_W + 'px;height:' + AXIS_H + 'px;">' +
      '<span class="tl-axis-corner-date" title="' + escAttr(dateRangeStr) + '">' + escapeHtml(dateRangeStr) + '</span>' +
      '<span class="tl-axis-corner-label">Click Ruler to Queue Time</span>' +
    '</div>'

    // Lane bands + labels (left sidebar): one band per uploader, with a
    // small channel label on each sub-row so body vs. fleet reads at a glance.
    // Bands scroll with the canvas; labels live in a sticky column so they
    // stay visible while panning horizontally.
    let laneBands = ''
    let laneSticky = ''
    laneList.forEach(function (lane, li) {
      const seenD = {}
      const deviceList = lane.deviceKeys.map(function (dk) { return lane.deviceLabels[dk] }).filter(function (lbl) {
        if (!lbl || seenD[lbl]) return false
        seenD[lbl] = true
        return true
      }).join(' \u00B7 ')
      const laneStartDate = new Date(lane.earliestStart)
      const laneTimeStr = (!isSameDay ? laneStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' : '') +
        laneStartDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      const metaText = laneTimeStr + ' \u00B7 ' + lane.items.length + (lane.items.length === 1 ? ' video' : ' videos') + (deviceList ? ' \u00B7 ' + deviceList : '')
      const maxWStyle = lane.subRowCount < 2 ? ' style="max-width:154px;"' : ''
      const allLaneSelected = lane.items.every(function (iv) { return selectedVideoIds.has(iv.video.id) })

      laneBands += '<div class="tl-lane-band' + (li % 2 ? ' tl-lane-band-alt' : '') + '" style="top:' + lane.top + 'px;height:' + lane.height + 'px;"></div>'
      laneSticky += '<div class="tl-lane-label" style="top:' + lane.top + 'px;height:' + lane.height + 'px;">' +
        '<div class="tl-lane-header-row">' +
          '<input type="checkbox" class="tl-lane-checkbox" data-lane-key="' + escAttr(lane.key) + '" ' + (allLaneSelected ? 'checked ' : '') + 'title="Toggle all videos for ' + escAttr(lane.label) + '">' +
          '<span class="tl-lane-name"' + maxWStyle + ' title="' + escAttr(lane.label) + '">' + escapeHtml(lane.label) + '</span>' +
        '</div>' +
        '<span class="tl-lane-meta"' + maxWStyle + ' title="' + escAttr(metaText) + '">' + escapeHtml(metaText) + '</span></div>'
      for (let sr = 0; sr < lane.subRowCount; sr++) {
        if (lane.subRowCount < 2) break
        const subTop = lane.top + LANE_PAD_TOP + sr * (SUB_H + SUB_GAP)
        laneSticky += '<div class="tl-sub-label" title="' + escAttr(lane.subRowLabels[sr] || '') + '" style="top:' + subTop + 'px;height:' + SUB_H + 'px;">' + escapeHtml(lane.subRowLabels[sr] || '') + '</div>'
      }
    })
    const laneLabelCol = laneSticky ? '<div class="tl-lane-col">' + laneSticky + '</div>' : ''
    const laneLabels = laneBands

    // Video bars: x = recorded time, y = uploader lane + device sub-row.
    // Clicking a bar toggles selection (activation) for review; small ↗ icon opens Evidence.com.
    let bars = ''
    laneList.forEach(function (lane) {
      lane.items.forEach(function (iv) {
        const v = iv.video
        const left = LABEL_W + ((iv.start - firstTs) / 1000) * pxPerSec
        const width = Math.max(MIN_BAR_W, ((iv.end - iv.start) / 1000) * pxPerSec)
        const top = lane.top + LANE_PAD_TOP + iv.subRow * (SUB_H + SUB_GAP)
        const kind = deviceKindFor(v)
        const isSelected = selectedVideoIds.has(v.id)
        const isAtPlayhead = tlPlayheadTime >= iv.start && tlPlayheadTime <= iv.end
        const title = v.title || v.id
        const recDate = new Date(iv.start)
        const recTimeStr = recDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
        let barText = (isSelected ? '\u2713 ' : '') + recTimeStr + ' \u00B7 ' + escAttr(title)
        if (v._deviceType) barText += ' \u00B7 ' + escAttr(formatValue('_deviceType', v._deviceType))
        barText += ' \u00B7 ' + escAttr(formatValue('duration', v.duration))
        const tooltip = escAttr(
          title + '\nDate & Time: ' + formatValue('recordedOn', v.recordedOn) +
          '\nDuration: ' + formatValue('duration', v.duration) +
          (v._uploadedBy ? '\nUploaded by: ' + v._uploadedBy : '') +
          (v._primaryOwner ? '\nOwner: ' + v._primaryOwner : '') +
          (v._deviceType ? '\nDevice: ' + formatValue('_deviceType', v._deviceType) : '') +
          '\n\nClick bar to ' + (isSelected ? 'deactivate' : 'activate') + ' video for sync review (Shift+click to also jump playhead here)'
        )
        const extLink = (v._link && v._link !== '#')
          ? '<a class="tl-bar-ext" href="' + escAttr(v._link) + '" target="_blank" title="Open on Evidence.com">\u2197</a>'
          : ''
        bars += '<div class="tl-bar tl-bar-' + kind + (isSelected ? ' tl-bar-selected' : '') + (isAtPlayhead ? ' tl-bar-at-playhead' : '') + '" data-video-id="' + escAttr(v.id) + '" data-uploader="' + escAttr(lane.label) + '" data-device-kind="' + kind + '" style="left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + SUB_H + 'px;" title="' + tooltip + '">' +
          '<span class="tl-bar-label">' + barText + '</span>' +
          extLink +
        '</div>'
      })
    })

    // Playhead cursor line across the timeline
    const playheadLeft = LABEL_W + ((tlPlayheadTime - firstTs) / 1000) * pxPerSec
    const activeAtPlayheadCount = countVideosAtTime(intervals, tlPlayheadTime)
    const playheadClockStr = formatRealClock(tlPlayheadTime, !isSameDay)
    const playheadHtml = '<div class="tl-playhead" id="tl-playhead" style="left:' + playheadLeft + 'px;top:0;height:' + canvasH + 'px;">' +
      '<div class="tl-playhead-cap" id="tl-playhead-cap" title="Drag or click timeline to scrub master time">' +
        '<span id="tl-playhead-time">' + escapeHtml(playheadClockStr) + '</span>' +
        '<span class="tl-playhead-count" id="tl-playhead-count">' + activeAtPlayheadCount + ' rec</span>' +
      '</div>' +
    '</div>'

    // Legend for the device kinds actually present, in lane order.
    const kindSeen = {}
    const kindOrder = []
    laneList.forEach(function (lane) {
      lane.items.forEach(function (iv) {
        const k = deviceKindFor(iv.video)
        if (!kindSeen[k]) { kindSeen[k] = true; kindOrder.push(k) }
      })
    })
    const kindNames = { body: 'Body', fleet: 'Fleet', taser: 'TASER', interview: 'Interview', other: 'Other' }
    const legend = kindOrder.length > 1
      ? '<span class="tl-legend">' + kindOrder.map(function (k) {
        return '<span class="tl-legend-item"><span class="tl-legend-dot tl-bar-' + k + '"></span>' + (kindNames[k] || k) + '</span>'
      }).join('') + '</span>'
      : ''

    // Date dropdown — unique dates from intervals
    const dateMap = {}
    intervals.forEach(function (iv) {
      const d = new Date(iv.start)
      const key = d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0')
      if (!dateMap[key]) dateMap[key] = { label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), offset: (iv.start - firstTs) / 1000 * pxPerSec }
    })
    const dates = Object.keys(dateMap).sort()
    const dateOpts = dates.map(function (k) {
      return '<option value="' + Math.round(dateMap[k].offset) + '">' + dateMap[k].label + '</option>'
    }).join('')

    const selCount = videos.filter(function (v) { return selectedVideoIds.has(v.id) }).length
    const hasVideoSrcs = videos.some(function (v) { return v._videoSrc })
    const syncBtnLabel = selCount > 0
      ? '\u25B6 Queue & Review Selected (' + selCount + ')'
      : '\u25B6 Queue Active at Playhead (' + activeAtPlayheadCount + ')'
    const syncBtn = '<button class="tl-sync-btn" data-action="sync-play" title="' + (hasVideoSrcs ? 'Open multi-camera sync player at playhead time' : 'Open timeline sync simulator (fetch file IDs on case page for live video streams)') + '">' + syncBtnLabel + '</button>'

    const selectionControls =
      '<button class="tl-sel-btn" data-action="select-at-playhead" title="Activate all videos recording at the current playhead time (' + escapeHtml(playheadClockStr) + ')">Select @ Playhead (' + activeAtPlayheadCount + ')</button>' +
      (selCount > 0 ? '<button class="tl-sel-btn" data-action="clear-selection" title="Clear selected videos">Clear (' + selCount + ')</button>' : '')

    const zoomLabel = tlZoom >= 1 ? tlZoom + 'x' : '1/' + Math.round(1 / tlZoom) + 'x'

    const headerDateBadge = '<span class="tl-header-date" title="Timeline span: ' + escAttr(dateRangeStr + ' (' + timeSpanStr + ')') + '">' +
      '<span class="tl-header-date-icon">\uD83D\uDCC5</span> ' + escapeHtml(dateRangeStr) +
      ' <span class="tl-header-time">(' + escapeHtml(timeSpanStr) + ')</span></span>'

    timelineView.innerHTML =
      '<div class="tl-header">' +
        '<span class="tl-header-title">' + videos.length + ' videos &middot; ' + numLanes + (numLanes === 1 ? ' uploader' : ' uploaders') + ' &middot; Peak ' + maxConcurrent + ' simultaneous</span>' +
        headerDateBadge +
        legend +
        '<div class="tl-header-controls">' +
          selectionControls +
          '<select class="tl-date-select" data-action="jump-date"><option value="">Jump to date\u2026</option>' + dateOpts + '</select>' +
          '<button class="tl-zoom-btn" data-action="zoom-out" title="Zoom out">\u2212</button>' +
          '<span class="tl-zoom-label">' + zoomLabel + '</span>' +
          '<button class="tl-zoom-btn" data-action="zoom-in" title="Zoom in">+</button>' +
          syncBtn +
        '</div>' +
      '</div>' +
      '<div class="tl-scroll" id="tl-scroll">' +
        '<div class="tl-canvas" id="tl-canvas" style="width:' + canvasW + 'px;height:' + canvasH + 'px;">' +
          laneLabelCol +
          '<div class="tl-axis" id="tl-axis" style="height:' + AXIS_H + 'px;">' +
            axisCorner +
            axisTicks +
          '</div>' +
          densityLaneHtml +
          gridLines +
          laneLabels +
          bars +
          playheadHtml +
        '</div>' +
      '</div>'

    // Wire CSP-safe event listeners (no inline handlers)
    timelineView.querySelector('.tl-date-select').addEventListener('change', function () {
      window.__axonJumpDate(this.value)
    })
    const zoomBtns = timelineView.querySelectorAll('.tl-zoom-btn')
    if (zoomBtns[0]) zoomBtns[0].addEventListener('click', function () { window.__axonZoom(-1) })
    if (zoomBtns[1]) zoomBtns[1].addEventListener('click', function () { window.__axonZoom(1) })
    const syncPlayBtn = timelineView.querySelector('[data-action="sync-play"]')
    if (syncPlayBtn) syncPlayBtn.addEventListener('click', function () { window.__axonSyncPlay() })

    const selAtPlayheadBtn = timelineView.querySelector('[data-action="select-at-playhead"]')
    if (selAtPlayheadBtn) {
      selAtPlayheadBtn.addEventListener('click', function () {
        selectVideosAtTime(tlPlayheadTime)
      })
    }
    const clearSelBtn = timelineView.querySelector('[data-action="clear-selection"]')
    if (clearSelBtn) {
      clearSelBtn.addEventListener('click', function () {
        selectedVideoIds.clear()
        renderTimeline()
        if (isSyncPlayerOpen()) refreshSyncPlayerVideos()
      })
    }

    // Wire lane checkboxes
    timelineView.querySelectorAll('.tl-lane-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function (e) {
        e.stopPropagation()
        const lKey = this.getAttribute('data-lane-key')
        const targetLane = laneList.find(function (l) { return l.key === lKey })
        if (!targetLane) return
        targetLane.items.forEach(function (iv) {
          if (cb.checked) selectedVideoIds.add(iv.video.id)
          else selectedVideoIds.delete(iv.video.id)
        })
        renderTimeline()
        if (isSyncPlayerOpen()) refreshSyncPlayerVideos()
      })
    })

    // Wire video bars: click toggles activation; Shift+click also moves playhead to click position
    timelineView.querySelectorAll('.tl-bar').forEach(function (barEl) {
      barEl.addEventListener('click', function (e) {
        if (e.target.closest('.tl-bar-ext')) return
        e.preventDefault()
        e.stopPropagation()
        const vid = this.getAttribute('data-video-id')
        if (!vid) return
        if (e.shiftKey) {
          const canvasEl = document.getElementById('tl-canvas')
          if (canvasEl && tlLayoutCache) {
            const rect = canvasEl.getBoundingClientRect()
            const clickX = e.clientX - rect.left
            const clickTs = tlLayoutCache.firstTs + Math.max(0, (clickX - tlLayoutCache.labelW) / tlLayoutCache.pxPerSec) * 1000
            selectedVideoIds.add(vid)
            setMasterPlayheadTime(clickTs, true)
          }
        } else {
          if (selectedVideoIds.has(vid)) selectedVideoIds.delete(vid)
          else selectedVideoIds.add(vid)
        }
        renderTimeline()
        if (isSyncPlayerOpen()) refreshSyncPlayerVideos()
      })
    })

    // Restore the horizontal/vertical viewport after the rebuild so bar and
    // lane toggles keep the user where they were in the timeline.
    tlScrollCollectionId = selectedCollectionId
    const freshScrollEl = document.getElementById('tl-scroll')
    if (freshScrollEl) {
      freshScrollEl.scrollLeft = prevScrollLeft
      freshScrollEl.scrollTop = prevScrollTop
    }

    // Wire clicking/dragging on the time axis, density track, or background canvas to move playhead
    setupTimelinePlayheadInteractions()
  }

  function buildFolderTree () {
    // Build nested tree from folderMap paths, then hang evidence items on leaf folders
    const root = { name: '', path: '', children: {}, items: [], folderId: null, depth: 0 }

    // Sort folders by path depth so parents are created before children
    const entries = Object.keys(folderMap).map(function (k) { return { id: k, info: folderMap[k] } })
    entries.sort(function (a, b) {
      return (a.info.path || '').split('/').length - (b.info.path || '').split('/').length
    })

    // Collect folder IDs referenced by any evidence item
    const usedFolderIds = {}
    filteredData.forEach(function (item) {
      const refs = item._raw && item._raw.relationships && item._raw.relationships.folders && item._raw.relationships.folders.data
      if (refs && Array.isArray(refs)) {
        refs.forEach(function (ref) { if (ref && ref.id) usedFolderIds[ref.id] = true })
      }
    })

    // Build tree nodes from folder paths
    entries.forEach(function (entry) {
      let parts = (entry.info.path || '').split('/').filter(Boolean)
      if (parts.length === 0) {
        // Folder with no path — attach directly under root with its name
        parts = [entry.info.name || entry.id]
      }
      let node = root
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!node.children[part]) {
          node.children[part] = { name: part, path: (node.path ? node.path + '/' : '') + part, children: {}, items: [], folderId: null, depth: node.depth + 1 }
        }
        node = node.children[part]
      }
      node.folderId = entry.id
      node._hasRefs = !!usedFolderIds[entry.id]
    })

    // Hang evidence items on their folders
    const unfiled = []
    filteredData.forEach(function (item) {
      const refs = item._raw && item._raw.relationships && item._raw.relationships.folders && item._raw.relationships.folders.data
      let placed = false
      if (refs && Array.isArray(refs)) {
        refs.forEach(function (ref) {
          if (!ref || !ref.id) return
          const info = folderMap[ref.id]
          if (info && info.path) {
            // Walk tree to find the node for this path
            const parts = info.path.split('/').filter(Boolean)
            let node = root
            let found = parts.length === 0
            for (let i = 0; i < parts.length; i++) {
              if (node.children[parts[i]]) {
                node = node.children[parts[i]]
                if (i === parts.length - 1) found = true
              } else { break }
            }
            if (found) { node.items.push(item); placed = true }
          }
        })
      }
      if (!placed) unfiled.push(item)
    })

    if (unfiled.length > 0) {
      root._unfiled = unfiled
    }

    return root
  }

  function renderFolderTree () {
    const tree = buildFolderTree()
    const children = Object.keys(tree.children).sort()

    const hasContent = children.length > 0 || (tree._unfiled && tree._unfiled.length > 0)
    if (!hasContent) {
      folderView.innerHTML = '<div style="padding:60px;text-align:center;color:#64748b;">No folder data captured for this collection.</div>'
      return
    }

    let html = ''
    // Unfiled items first
    if (tree._unfiled && tree._unfiled.length > 0) {
      html += '<div class="ft-root-section">' +
        '<div class="ft-node ft-node-root" data-expanded="true">' +
          '<span class="ft-toggle">▼</span>' +
          '<span class="ft-name">Unfiled</span>' +
          '<span class="ft-count">' + tree._unfiled.length + '</span>' +
        '</div>' +
        '<div class="ft-children">' +
          tree._unfiled.map(function (item) { return renderItemRow(item, 2) }).join('') +
        '</div>' +
      '</div>'
    }
    // Folder tree
    children.forEach(function (key) {
      html += renderTreeNode(tree.children[key])
    })

    folderView.innerHTML = html

    // Wire expand/collapse after render
    folderView.querySelectorAll('.ft-toggle').forEach(function (toggle) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation()
        const node = toggle.parentElement
        const expanded = node.getAttribute('data-expanded') === 'true'
        node.setAttribute('data-expanded', String(!expanded))
        toggle.textContent = expanded ? '▶' : '▼'
        const children = node.nextElementSibling
        if (children && children.classList.contains('ft-children')) {
          children.style.display = expanded ? 'none' : ''
        }
      })
    })
  }

  function renderTreeNode (node) {
    const children = Object.keys(node.children).sort()
    const hasChildren = children.length > 0 || node.items.length > 0
    const expandable = children.length > 0 || (node.items.length > 0 && (!node.folderId || !node._hasRefs))
    const itemRows = node.items.map(function (item) { return renderItemRow(item, node.depth + 1) }).join('')

    let html = ''
    html += '<div class="ft-node" data-expanded="' + expandable + '" style="padding-left:' + (node.depth * 18) + 'px">'
    html += '<span class="ft-toggle">' + (expandable ? '▼' : '•') + '</span>'
    html += '<span class="ft-name">' + escapeHtml(node.name) + '</span>'
    if (node.items.length > 0) html += '<span class="ft-count">' + node.items.length + '</span>'
    html += '</div>'

    if (expandable) {
      html += '<div class="ft-children">'
      if (itemRows) html += itemRows
      children.forEach(function (key) {
        html += renderTreeNode(node.children[key])
      })
      html += '</div>'
    }

    return html
  }

  function renderItemRow (item, depth) {
    const icon = item.fileType === 'image' ? '🖼' : item.fileType === 'video' ? '🎬' : item.fileType === 'audio' ? '🔊' : '📄'
    const link = (item._link && item._link !== '#') ? item._link : ''
    const title = item.title || item.id
    return '<a class="ft-item' + (link ? ' ft-item-link' : '') + '" style="padding-left:' + (depth * 18) + 'px" href="' + escAttr(link) + '" target="_blank" data-slideshow="' + escAttr(item._thumb || '') + '">' +
      '<span class="ft-item-icon">' + icon + '</span>' +
      '<span class="ft-item-name">' + escapeHtml(title) + '</span>' +
      '<span class="ft-item-meta">' + escapeHtml(formatValue('recordedOn', item.recordedOn)) + '</span>' +
    '</a>'
  }

  function setupHoverPreview () {
    document.querySelectorAll('#table-body img, .gallery-img').forEach(function (img) {
      img.addEventListener('mouseenter', function (e) {
        if (!img.src || img.style.display === 'none') return
        previewImg.src = img.src
        previewEl.style.display = 'block'
        updatePreviewPos(e)
      })
      img.addEventListener('mousemove', function (e) {
        updatePreviewPos(e)
      })
      img.addEventListener('mouseleave', function () {
        previewEl.style.display = 'none'
      })
    })
  }

  function updatePreviewPos (e) {
    let x = e.clientX + 16
    let y = e.clientY - 100
    if (x + 320 > window.innerWidth) x = e.clientX - 320
    if (y < 0) y = e.clientY + 16
    previewEl.style.left = x + 'px'
    previewEl.style.top = y + 'px'
  }

  function doRender () {
    if (timelineMode) {
      renderTimeline()
    } else if (galleryMode) {
      renderGallery()
    } else if (folderMode) {
      dataTable.style.display = 'none'
      tableHead.style.display = 'none'
      galleryView.style.display = 'none'
      timelineView.style.display = 'none'
      folderView.style.display = ''
      renderFolderTree()
    } else {
      dataTable.style.display = ''
      tableHead.style.display = ''
      galleryView.style.display = 'none'
      timelineView.style.display = 'none'
      folderView.style.display = 'none'
      renderTable()
    }
    setupHoverPreview()
  }

  function escapeHtml (str) { const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML }
  function escAttr (str) { return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  let resizing = null

  function setupResize () {
    document.querySelectorAll('#table-head .col-resize-handle').forEach(function (h) {
      h.onmousedown = function (e) {
        e.preventDefault()
        e.stopPropagation()
        const th = h.parentElement
        const col = th.dataset.col
        const startX = e.clientX
        const startW = th.offsetWidth
        resizing = { th, col, startX, startW }
        document.addEventListener('mousemove', onResizeMove)
        document.addEventListener('mouseup', onResizeUp)
      }
    })
  }

  function onResizeMove (e) {
    if (!resizing) return
    const w = Math.max(40, resizing.startW + (e.clientX - resizing.startX))
    resizing.th.style.width = w + 'px'
  }

  function onResizeUp () {
    if (!resizing) return
    colWidths[resizing.col] = resizing.th.offsetWidth
    resizing.th.style.width = colWidths[resizing.col] + 'px'
    resizing = null
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeUp)
  }

  let dragCol = null

  function setupDragDrop () {
    document.querySelectorAll('#table-head th[draggable]').forEach(function (th) {
      th.ondragstart = function (e) {
        dragCol = th.dataset.col
        th.classList.add('dragging')
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', dragCol)
      }
      th.ondragend = function () {
        th.classList.remove('dragging')
        document.querySelectorAll('#table-head th.drag-over').forEach(function (el) { el.classList.remove('drag-over') })
        dragCol = null
      }
      th.ondragover = function (e) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        th.classList.add('drag-over')
      }
      th.ondragleave = function () {
        th.classList.remove('drag-over')
      }
      th.ondrop = function (e) {
        e.preventDefault()
        const from = dragCol
        const to = th.dataset.col
        if (!from || !to || from === to) return
        const fi = columns.indexOf(from); const ti = columns.indexOf(to)
        if (fi < 0 || ti < 0) return
        columns.splice(fi, 1)
        columns.splice(ti, 0, from)
        visibleColumns.sort(function (a, b) { return columns.indexOf(a) - columns.indexOf(b) })
        dragCol = null
        doRender()
        buildColumnDropdown()
      }
    })
  }

  function updateStats () {
    if (!selectedCollectionId || allData.length === 0) { statsBar.style.display = 'none'; return }
    const types = {}
    allData.forEach(function (r) { const t = r.fileType || 'unknown'; types[t] = (types[t] || 0) + 1 })
    const typeBadges = Object.entries(types).sort(function (a, b) { return b[1] - a[1] })
      .map(function (e) {
        const active = fileTypeFilter === e[0]
        const style = active ? 'background:#38bdf8;color:#0f172a;font-weight:600;' : 'background:#334155;color:#e2e8f0;'
        return '<span class="filetype-badge" data-type="' + e[0] + '" style="display:inline-block;padding:1px 8px;border-radius:10px;margin:0 3px;cursor:pointer;font-size:11px;' + style + '">' + e[0] + ': ' + e[1] + (active ? ' \u2715' : '') + '</span>'
      }).join('')
    let shown = fileTypeFilter ? allData.filter(function (r) { return (r.fileType || 'unknown') === fileTypeFilter }).length : allData.length
    const deviceOwnerByIdentity = buildDeviceOwnerMap(allData)
    if (deviceFilter) {
      shown = allData.filter(function (r) { return matchesDeviceFilter(r, deviceFilter, deviceOwnerByIdentity) }).length
    }

    // Device badges: one badge per person (combining all cameras/footage for
    // that officer, e.g. Body + Fleet), with parenthetical agency/badge suffix
    // stripped so it displays as "Last, First". Records with a device but no
    // resolvable person fall back to their device/camera-type bucket.
    const deviceCounts = {}
    const deviceLabels = {}
    const deviceLabelHasComma = {}
    allData.forEach(function (r) {
      const b = deviceBadgeBucketFor(r, deviceOwnerByIdentity)
      if (!b) return
      deviceCounts[b.key] = (deviceCounts[b.key] || 0) + 1
      if (!deviceLabels[b.key] || (b.hasComma && !deviceLabelHasComma[b.key])) {
        deviceLabels[b.key] = b.label
        deviceLabelHasComma[b.key] = b.hasComma
      }
    })
    let deviceBadges = ''
    if (Object.keys(deviceCounts).length > 0) {
      deviceBadges = ' &nbsp; ' + Object.entries(deviceCounts).sort(function (a, b) { return b[1] - a[1] })
        .map(function (e) {
          const key = e[0]
          const label = deviceLabels[key] || key
          const active = deviceFilter === key
          const style = active ? 'background:#a855f7;color:#0f172a;font-weight:600;' : 'background:#1e1b4b;color:#c4b5fd;'
          return '<span class="device-badge" data-device="' + escAttr(key) + '" style="display:inline-block;padding:1px 8px;border-radius:10px;margin:0 3px;cursor:pointer;font-size:11px;' + style + '">' + escapeHtml(label) + ': ' + e[1] + (active ? ' \u2715' : '') + '</span>'
        }).join('')
    }

    statsBar.style.display = 'block'
    statsBar.innerHTML = '<strong>' + shown + '</strong> / ' + allData.length + ' records &nbsp; ' + typeBadges + deviceBadges

    statsBar.querySelectorAll('.filetype-badge').forEach(function (badge) {
      badge.addEventListener('click', function (e) {
        e.stopPropagation()
        const ft = this.dataset.type
        if (fileTypeFilter === ft) {
          fileTypeFilter = null
        } else {
          fileTypeFilter = ft
          deviceFilter = null
        }
        searchData(searchInput.value)
        doRender()
        updateStats()
      })
    })
    statsBar.querySelectorAll('.device-badge').forEach(function (badge) {
      badge.addEventListener('click', function (e) {
        e.stopPropagation()
        const dv = this.dataset.device
        if (deviceFilter === dv) {
          deviceFilter = null
        } else {
          deviceFilter = dv
          fileTypeFilter = null
        }
        searchData(searchInput.value)
        doRender()
        updateStats()
      })
    })
  }

  function showTable () { dataTable.style.display = ''; galleryView.style.display = 'none'; timelineView.style.display = 'none'; folderView.style.display = 'none'; emptyState.style.display = 'none' }
  function showEmpty (customMsg, isCollecting) {
    dataTable.style.display = 'none'
    galleryView.style.display = 'none'
    timelineView.style.display = 'none'
    folderView.style.display = 'none'
    emptyState.style.display = ''
    statsBar.style.display = 'none'
    if (customMsg) {
      emptyState.innerHTML = '<p>' + escapeHtml(customMsg) + '</p>' +
        (isCollecting ? '<div style="margin-top:12px;color:#38bdf8;font-size:13px;animation:pulse 2s infinite;">⏳ Collection in progress… Data will appear automatically as it is gathered.</div>' : '')
    } else {
      emptyState.innerHTML = '<p>No data loaded. Start aggregating on an evidence.com review page.</p>'
    }
  }

  function getCollectionDisplayLabel (c) {
    if (!c) return ''
    if (c.caseLabel) return c.caseLabel
    if (c.id && c.id.indexOf('-') >= 8) return 'Case ' + c.id.split('-')[0].toUpperCase() + '…'
    if (c.baseUrl) {
      try { return new URL(c.baseUrl).hostname } catch (e) { return c.id }
    }
    return c.id || 'Unnamed Case'
  }

  function formatCaseDate (isoString) {
    if (!isoString) return ''
    try {
      const d = new Date(isoString)
      if (isNaN(d.getTime())) return ''
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch (e) {
      return ''
    }
  }

  function highlightMatches (text, query) {
    if (!text) return ''
    if (!query || !query.trim()) return escapeHtml(text)
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return escapeHtml(text)
    const pattern = tokens.map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }).join('|')
    const regex = new RegExp('(' + pattern + ')', 'gi')
    const testRegex = new RegExp('^(?:' + pattern + ')$', 'i')
    const parts = text.split(regex)
    return parts.map(function (part) {
      if (!part) return ''
      if (testRegex.test(part)) {
        return '<mark class="case-item-match">' + escapeHtml(part) + '</mark>'
      }
      return escapeHtml(part)
    }).join('')
  }

  function updateCaseSearchDisplay (target) {
    if (!caseSearchInput) return
    if (!target) {
      caseSearchInput.value = ''
      caseSearchInput.placeholder = cachedCollections.length === 0 ? 'No cases loaded' : 'Search or select case… (Ctrl+K)'
      caseSearchInput.disabled = cachedCollections.length === 0
      if (caseDropdownToggle) caseDropdownToggle.disabled = cachedCollections.length === 0
      btnRename.disabled = true
      if (caseSearchClear) caseSearchClear.style.display = 'none'
      return
    }
    const label = getCollectionDisplayLabel(target)
    caseSearchInput.value = label
    caseSearchInput.placeholder = 'Search or select case… (Ctrl+K)'
    caseSearchInput.disabled = false
    if (caseDropdownToggle) caseDropdownToggle.disabled = false
    btnRename.disabled = false
    if (caseSearchClear) caseSearchClear.style.display = 'none'
  }

  function showCaseDropdown () {
    if (!caseDropdownList) return
    caseDropdownList.style.display = 'block'
    if (caseDropdownToggle) caseDropdownToggle.textContent = '▲'
    if (caseSearchInput) caseSearchInput.setAttribute('aria-expanded', 'true')
  }

  function hideCaseDropdown () {
    if (!caseDropdownList) return
    caseDropdownList.style.display = 'none'
    if (caseDropdownToggle) caseDropdownToggle.textContent = '▼'
    if (caseSearchInput) caseSearchInput.setAttribute('aria-expanded', 'false')
    activeDropdownIndex = -1
  }

  function renderCaseDropdownList (filterTerm) {
    if (!caseDropdownList) return
    const term = (filterTerm || '').trim().toLowerCase()
    const tokens = term ? term.split(/\s+/).filter(Boolean) : []

    let matched = cachedCollections.slice()
    if (tokens.length > 0) {
      matched = matched.filter(function (c) {
        const searchBlob = (getCollectionDisplayLabel(c) + ' ' + (c.caseLabel || '') + ' ' + (c.id || '') + ' ' + (c.baseUrl || '') + ' ' + (c.status || '')).toLowerCase()
        return tokens.every(function (tok) { return searchBlob.indexOf(tok) !== -1 })
      })
    }

    if (matched.length === 0) {
      caseDropdownList.innerHTML = '<div class="case-empty-msg">No cases found' + (term ? ' matching "' + escapeHtml(filterTerm) + '"' : '') + '</div>'
      activeDropdownIndex = -1
      return
    }

    activeDropdownIndex = -1

    caseDropdownList.innerHTML = matched.map(function (c, idx) {
      const isSelected = c.id === selectedCollectionId
      const label = getCollectionDisplayLabel(c)
      const highlightedLabel = tokens.length > 0 ? highlightMatches(label, filterTerm) : escapeHtml(label)
      const dateStr = formatCaseDate(c.updatedAt || c.completedAt || c.createdAt)
      const count = typeof c.count === 'number' ? c.count : 0
      const statusClass = c.status ? 'case-status-' + c.status.toLowerCase() : ''
      const shortId = c.id ? (c.id.length > 18 ? c.id.slice(0, 10) + '…' + c.id.slice(-6) : c.id) : ''
      const highlightedId = tokens.length > 0 ? highlightMatches(shortId, filterTerm) : escapeHtml(shortId)

      return '<div class="case-item' + (isSelected ? ' active-case' : '') + '" role="option" aria-selected="' + (isSelected ? 'true' : 'false') + '" data-id="' + escapeHtml(c.id) + '" data-idx="' + idx + '">' +
        '<div class="case-item-header">' +
          '<div class="case-item-title" title="' + escapeHtml(label) + '">' +
            (isSelected ? '<span class="case-check" title="Currently active case">✓ </span>' : '') +
            highlightedLabel +
          '</div>' +
          '<div class="case-item-badges">' +
            '<span class="case-badge-records">' + count + ' rec</span>' +
            '<span class="case-badge-status ' + statusClass + '">' + escapeHtml(c.status || '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="case-item-meta">' +
          '<span class="case-item-id" title="' + escapeHtml(c.id || '') + '">' + highlightedId + '</span>' +
          (dateStr ? '<span class="case-item-date">' + escapeHtml(dateStr) + '</span>' : '') +
        '</div>' +
      '</div>'
    }).join('')

    const itemEls = caseDropdownList.querySelectorAll('.case-item')
    itemEls.forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation()
        const cid = this.getAttribute('data-id')
        selectCase(cid)
      })
      el.addEventListener('mouseenter', function () {
        itemEls.forEach(function (i) { i.classList.remove('selected') })
        this.classList.add('selected')
        activeDropdownIndex = parseInt(this.getAttribute('data-idx'), 10)
      })
    })
  }

  function selectCase (collectionId) {
    if (!collectionId) return
    const col = cachedCollections.find(function (c) { return c.id === collectionId })
    selectedCollectionId = collectionId
    collectionSelect.value = collectionId
    updateCaseSearchDisplay(col)
    hideCaseDropdown()
    updateCaseMatchBanner('')
    if (window.location.hash !== '#collectionId=' + collectionId) {
      window.location.hash = '#collectionId=' + collectionId
    }
    loadEvidence(collectionId)
  }

  function updateCaseMatchBanner (term) {
    if (!caseMatchBanner) return
    const q = (term || '').trim().toLowerCase()
    if (!q || q.length < 2 || cachedCollections.length <= 1) {
      caseMatchBanner.style.display = 'none'
      caseMatchBanner.innerHTML = ''
      return
    }
    const otherCols = cachedCollections.filter(function (c) {
      if (c.id === selectedCollectionId) return false
      const label = getCollectionDisplayLabel(c).toLowerCase()
      const rawId = (c.id || '').toLowerCase()
      return label.indexOf(q) !== -1 || rawId.indexOf(q) !== -1
    })

    if (otherCols.length === 0) {
      caseMatchBanner.style.display = 'none'
      caseMatchBanner.innerHTML = ''
      return
    }

    const first = otherCols[0]
    const label = getCollectionDisplayLabel(first)
    let bannerHtml = '<span>💡 Looking for a case? Found matching case: <strong>' + escapeHtml(label) + '</strong> (' + (first.count || 0) + ' records)</span>' +
      '<button type="button" class="case-match-banner-btn" data-switch-id="' + escapeHtml(first.id) + '">Switch to this case &rarr;</button>'

    if (otherCols.length > 1) {
      bannerHtml += '<span style="font-size:11px;color:#94a3b8;margin-left:6px;">(+' + (otherCols.length - 1) + ' more in Case Search)</span>'
    }

    caseMatchBanner.innerHTML = bannerHtml
    caseMatchBanner.style.display = 'flex'

    const switchBtn = caseMatchBanner.querySelector('[data-switch-id]')
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        selectCase(this.getAttribute('data-switch-id'))
      })
    }
  }

  async function loadCollections (keepSelection) {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'get-collections' })
      const collections = (resp && resp.collections) ? resp.collections : []
      cachedCollections = collections

      let hashId = null
      const hash = window.location.hash
      if (hash && hash.indexOf('#collectionId=') === 0) {
        hashId = hash.replace('#collectionId=', '')
      }

      btnRename.disabled = collections.length === 0

      const currentVal = keepSelection ? (collectionSelect.value || selectedCollectionId) : (hashId || selectedCollectionId)

      collectionSelect.innerHTML = '<option value="">Select a collection\u2026</option>' +
        collections.map(function (c) {
          const label = getCollectionDisplayLabel(c)
          return '<option value="' + c.id + '">' + escapeHtml(label) + ' \u2014 ' + (c.count || 0) + ' records (' + c.status + ')</option>'
        }).join('')

      if (collections.length > 0) {
        let target = null
        if (currentVal) {
          target = collections.find(function (c) { return c.id === currentVal })
        }
        if (!target && hashId) {
          target = collections.find(function (c) { return c.id === hashId })
        }
        if (!target) {
          target = collections[0]
        }
        if (target) {
          collectionSelect.value = target.id
          updateCaseSearchDisplay(target)
          if (!selectedCollectionId || selectedCollectionId !== target.id) {
            loadEvidence(target.id)
          }
        }
      } else {
        selectedCollectionId = null
        updateCaseSearchDisplay(null)
        showEmpty('No collections found. Start aggregating on an evidence.com review page.')
      }
    } catch (e) { console.error('[AxonViewer] loadCollections error:', e) }
  }

  async function loadEvidence (collectionId, preserveFilters) {
    if (!preserveFilters) {
      selectedCollectionId = collectionId
      if (window.location.hash !== '#collectionId=' + collectionId) {
        history.replaceState(null, '', '#collectionId=' + collectionId)
      }
      searchInput.value = ''
      searchInput.disabled = true
      updateCaseMatchBanner('')
      fileTypeFilter = null
      deviceFilter = null
      linkOrigin = ''
      linkCasePath = ''
      fileMap = {}
      pageMap = {}
      thumbMap = {}
      folderMap = {}
      colWidths = {}
      visibleColumns = []
      selectedVideoIds.clear()
      tlPlayheadTime = null
      closeSyncPlayer()
    } else {
      selectedCollectionId = collectionId
    }

    let colMeta = null
    try {
      const colResp = await chrome.runtime.sendMessage({ action: 'get-collections' })
      if (colResp && colResp.collections) {
        colMeta = colResp.collections.find(function (c) { return c.id === collectionId })
        if (colMeta) {
          const refUrl = colMeta.pageUrl || colMeta.baseUrl
          if (refUrl) {
            try {
              const refParsed = new URL(refUrl)
              linkOrigin = refParsed.origin
              const pathMatch = refParsed.pathname.match(/^(.*\/case\/[a-fA-F0-9-]+)/)
              if (pathMatch) linkCasePath = pathMatch[1]
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    try {
      const fileResp = await chrome.runtime.sendMessage({ action: 'get-files', collectionId })
      if (fileResp && fileResp.files) {
        fileMap = {}
        fileResp.files.forEach(function (f) { fileMap[f.evidenceId] = f })
      }
    } catch (e) { console.error('[AxonViewer] Failed to load files:', e) }

    try {
      const pageResp = await chrome.runtime.sendMessage({ action: 'get-pages', collectionId })
      if (pageResp && pageResp.pages) {
        pageMap = pageResp.pages
      }
    } catch (e) { console.error('[AxonViewer] Failed to load page counts:', e) }

    try {
      const thumbResp = await chrome.runtime.sendMessage({ action: 'get-thumbnails', collectionId })
      if (thumbResp && thumbResp.thumbnails) {
        thumbMap = thumbResp.thumbnails
      }
    } catch (e) { console.error('[AxonViewer] Failed to load thumbnails:', e) }

    try {
      const folderResp = await chrome.runtime.sendMessage({ action: 'get-folders', collectionId })
      if (folderResp && folderResp.folders) {
        folderMap = folderResp.folders
      }
    } catch (e) { console.error('[AxonViewer] Failed to load folders:', e) }

    try {
      const resp = await chrome.runtime.sendMessage({ action: 'get-evidence', collectionId })
      if (resp && resp.evidence && resp.evidence.length > 0) {
        allData = resp.evidence.map(function (item) { const f = extractFlatRecord(item); f._raw = item; return f })
        let imgCount = 0; let imgWithFile = 0; let imgWithDetail = 0; let pdfCount = 0; let pdfWithPages = 0
        allData.forEach(function (r) {
          if (r.fileType === 'image') { imgCount++; if (r._thumb) imgWithFile++; if (r._thumb && r._thumb.indexOf('data:') === 0) imgWithDetail++ }
          if (r.fileType === 'document' && r.contentType === 'application/pdf') { pdfCount++; if (r._pages) pdfWithPages++ }
        })
        console.log('[AxonViewer]', imgCount, 'images:', imgWithDetail, 'cached,', (imgWithFile - imgWithDetail), 'remote,', (imgCount - imgWithFile), 'missing')
        console.log('[AxonViewer]', pdfCount, 'PDFs:', pdfWithPages, 'with page counts')
        columns = detectColumns()
        const showThumb = allData.some(function (r) { return r.fileType === 'image' })

        if (!preserveFilters || visibleColumns.length === 0) {
          visibleColumns = columns.filter(function (c) {
            return DEFAULT_VISIBLE_COLUMNS.indexOf(c) >= 0 && (c !== '_thumb' || showThumb)
          })
          buildColumnDropdown()
        } else {
          visibleColumns = visibleColumns.filter(function (c) { return columns.indexOf(c) >= 0 })
          buildColumnDropdown()
        }

        if (preserveFilters && (searchInput.value || fileTypeFilter || deviceFilter)) {
          searchData(searchInput.value)
        } else {
          filteredData = allData.slice()
        }

        if (preserveFilters && sortColumn) {
          const curCol = sortColumn
          const curDir = sortDir
          sortColumn = null
          sortData(curCol)
          if (sortDir !== curDir) {
            sortData(curCol)
          }
        }

        const isCollecting = colMeta && colMeta.status === 'collecting'
        recordCount.textContent = allData.length + ' records' + (isCollecting ? ' (collecting…)' : '')
        searchInput.disabled = false
        document.getElementById('btn-columns').disabled = false
        document.getElementById('btn-export-json').disabled = false
        document.getElementById('btn-export-csv').disabled = false
        document.getElementById('btn-delete').disabled = false
        document.getElementById('btn-gallery').disabled = false
        document.getElementById('btn-timeline').disabled = false
        document.getElementById('btn-folders').disabled = false
        updateStats(); showTable(); doRender()
      } else {
        allData = []
        filteredData = []
        recordCount.textContent = '0 records'
        const isCollecting = colMeta && colMeta.status === 'collecting'
        showEmpty(isCollecting ? 'Collection in progress… Found 0 items so far.' : 'No evidence items found in this collection.', isCollecting)
      }
    } catch (e) { console.error(e); showEmpty('Failed to load evidence: ' + e.message) }
  }

  function exportJSON () {
    const data = allData.map(function (r) { return r._raw || r })
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'evidence-export.json')
  }
  function exportCSV () {
    const keys = visibleColumns.length > 0 ? visibleColumns : columns
    const rows = filteredData.map(function (row) {
      return keys.map(function (k) {
        const val = k === '_link' ? row[k] : formatValue(k, row[k])
        return /[",\n]/.test(val) ? '"' + val.replace(/"/g, '""') + '"' : val
      }).join(',')
    })
    downloadBlob(new Blob([keys.map(function (k) { return FIELD_LABELS[k] || k }).join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' }), 'evidence-export.csv')
  }
  function downloadBlob (blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  async function deleteCollection () {
    if (!selectedCollectionId) return
    const col = cachedCollections.find(function (c) { return c.id === selectedCollectionId })
    const caseName = col ? getCollectionDisplayLabel(col) : 'this case'
    if (!confirm('Delete "' + caseName + '" and all its evidence data?')) return
    try { await chrome.runtime.sendMessage({ action: 'delete-collection', collectionId: selectedCollectionId }) } catch (e) {}
    allData = []; filteredData = []; fileTypeFilter = null; deviceFilter = null; selectedCollectionId = null; linkOrigin = ''; linkCasePath = ''; fileMap = {}; pageMap = {}; thumbMap = {}; folderMap = {}
    galleryMode = false; timelineMode = false; folderMode = false
    searchInput.value = ''; searchInput.disabled = true
    updateCaseSearchDisplay(null)
    updateCaseMatchBanner('')
    document.getElementById('btn-columns').disabled = true
    document.getElementById('btn-export-json').disabled = true
    document.getElementById('btn-export-csv').disabled = true
    document.getElementById('btn-gallery').disabled = true
    document.getElementById('btn-timeline').disabled = true
    document.getElementById('btn-folders').disabled = true
    document.getElementById('btn-delete').disabled = true
    showEmpty(); loadCollections()
  }

  searchInput.addEventListener('input', function () {
    searchData(this.value)
    updateCaseMatchBanner(this.value)
    doRender()
  })
  collectionSelect.addEventListener('change', function () {
    if (this.value) {
      selectCase(this.value)
    } else {
      allData = []
      filteredData = []
      selectedCollectionId = null
      updateCaseSearchDisplay(null)
      showEmpty()
    }
  })
  btnRename.addEventListener('click', async function () {
    const id = selectedCollectionId || collectionSelect.value
    if (!id) { alert('Select a case first.'); return }
    const col = cachedCollections.find(function (c) { return c.id === id })
    const current = col ? (col.caseLabel || getCollectionDisplayLabel(col)) : ''
    const newName = prompt('Rename case / collection:', current)
    if (newName == null) return // cancelled
    const trimmed = newName.trim()
    if (!trimmed) return
    await chrome.runtime.sendMessage({ action: 'rename-collection', collectionId: id, name: trimmed })
    await loadCollections(true)
  })

  // ── Case Search & Dropdown Interactions ─────────────────────
  if (caseSearchInput) {
    caseSearchInput.addEventListener('focus', function () {
      this.select()
      if (caseSearchClear) caseSearchClear.style.display = this.value ? 'flex' : 'none'
      renderCaseDropdownList('')
      showCaseDropdown()
    })

    caseSearchInput.addEventListener('input', function () {
      if (caseSearchClear) caseSearchClear.style.display = this.value ? 'flex' : 'none'
      renderCaseDropdownList(this.value)
      showCaseDropdown()
    })

    caseSearchInput.addEventListener('keydown', function (e) {
      const isOpen = caseDropdownList && caseDropdownList.style.display !== 'none'
      const items = caseDropdownList ? caseDropdownList.querySelectorAll('.case-item') : []

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (!isOpen) {
          showCaseDropdown()
          renderCaseDropdownList(this.value)
          return
        }
        if (items.length === 0) return
        activeDropdownIndex = (activeDropdownIndex + 1) % items.length
        items.forEach(function (el, i) {
          if (i === activeDropdownIndex) {
            el.classList.add('selected')
            el.scrollIntoView({ block: 'nearest' })
          } else {
            el.classList.remove('selected')
          }
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (!isOpen) return
        if (items.length === 0) return
        activeDropdownIndex = activeDropdownIndex <= 0 ? items.length - 1 : activeDropdownIndex - 1
        items.forEach(function (el, i) {
          if (i === activeDropdownIndex) {
            el.classList.add('selected')
            el.scrollIntoView({ block: 'nearest' })
          } else {
            el.classList.remove('selected')
          }
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (isOpen && items.length > 0) {
          const targetItem = (activeDropdownIndex >= 0 && items[activeDropdownIndex]) ? items[activeDropdownIndex] : items[0]
          if (targetItem) {
            const cid = targetItem.getAttribute('data-id')
            selectCase(cid)
            this.blur()
          }
        }
      } else if (e.key === 'Escape') {
        hideCaseDropdown()
        const cur = cachedCollections.find(function (c) { return c.id === selectedCollectionId })
        this.value = cur ? getCollectionDisplayLabel(cur) : ''
        if (caseSearchClear) caseSearchClear.style.display = 'none'
        this.blur()
      }
    })
  }

  if (caseSearchClear) {
    caseSearchClear.addEventListener('click', function (e) {
      e.stopPropagation()
      caseSearchInput.value = ''
      caseSearchClear.style.display = 'none'
      caseSearchInput.focus()
      renderCaseDropdownList('')
      showCaseDropdown()
    })
  }

  if (caseDropdownToggle) {
    caseDropdownToggle.addEventListener('click', function (e) {
      e.stopPropagation()
      const isOpen = caseDropdownList && caseDropdownList.style.display !== 'none'
      if (isOpen) {
        hideCaseDropdown()
      } else {
        caseSearchInput.focus()
        caseSearchInput.select()
        renderCaseDropdownList('')
        showCaseDropdown()
      }
    })
  }

  document.addEventListener('click', function (e) {
    const wrap = document.getElementById('case-selector-wrap')
    if (wrap && !wrap.contains(e.target)) {
      hideCaseDropdown()
      const cur = cachedCollections.find(function (c) { return c.id === selectedCollectionId })
      if (cur && caseSearchInput) {
        caseSearchInput.value = getCollectionDisplayLabel(cur)
      } else if (!selectedCollectionId && caseSearchInput) {
        caseSearchInput.value = ''
      }
      if (caseSearchClear) caseSearchClear.style.display = 'none'
    }
  })

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      if (caseSearchInput && !caseSearchInput.disabled) {
        caseSearchInput.focus()
        caseSearchInput.select()
        renderCaseDropdownList('')
        showCaseDropdown()
      }
    }
  })
  document.getElementById('btn-columns').addEventListener('click', function (e) {
    e.stopPropagation()
    const dd = document.getElementById('column-dropdown')
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none'
  })
  document.addEventListener('click', function () {
    document.getElementById('column-dropdown').style.display = 'none'
  })
  document.getElementById('column-dropdown').addEventListener('click', function (e) { e.stopPropagation() })
  document.getElementById('btn-export-json').addEventListener('click', exportJSON)
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV)
  document.getElementById('btn-gallery').addEventListener('click', function () {
    galleryMode = !galleryMode
    timelineMode = false
    folderMode = false
    this.textContent = galleryMode ? 'Table' : 'Gallery'
    document.getElementById('btn-timeline').textContent = 'Timeline'
    document.getElementById('btn-folders').textContent = 'Folders'
    doRender()
  })
  document.getElementById('btn-timeline').addEventListener('click', function () {
    timelineMode = !timelineMode
    galleryMode = false
    folderMode = false
    this.textContent = timelineMode ? 'Table' : 'Timeline'
    document.getElementById('btn-gallery').textContent = 'Gallery'
    document.getElementById('btn-folders').textContent = 'Folders'
    doRender()
  })
  document.getElementById('btn-folders').addEventListener('click', function () {
    folderMode = !folderMode
    galleryMode = false
    timelineMode = false
    this.textContent = folderMode ? 'Table' : 'Folders'
    document.getElementById('btn-gallery').textContent = 'Gallery'
    document.getElementById('btn-timeline').textContent = 'Timeline'
    doRender()
  })
  document.getElementById('btn-delete').addEventListener('click', deleteCollection)

  // Light/dark mode toggle
  const btnTheme = document.getElementById('btn-theme')
  const THEME_KEY = 'axon_viewer_theme'
  function applyTheme (theme) {
    if (theme === 'light') {
      document.body.classList.add('light-mode')
      btnTheme.textContent = '🌙'
      btnTheme.title = 'Switch to dark mode'
    } else {
      document.body.classList.remove('light-mode')
      btnTheme.textContent = '☀'
      btnTheme.title = 'Switch to light mode'
    }
  }
  chrome.storage.local.get(THEME_KEY, function (res) { applyTheme(res[THEME_KEY] || 'dark') })
  btnTheme.addEventListener('click', function () {
    const next = document.body.classList.contains('light-mode') ? 'dark' : 'light'
    applyTheme(next)
    chrome.storage.local.set({ [THEME_KEY]: next })
  })

  // --- Master Timeline Playhead & Sync Player ---

  function getVideoStreamInfo (videoSrc) {
    try {
      const formatId = function (id) {
        const raw = String(id || '').trim()
        return /^[0-9a-f]{32}$/i.test(raw)
          ? raw.slice(0, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16) + '-' + raw.slice(16, 20) + '-' + raw.slice(20)
          : raw
      }
      const source = new URL(videoSrc)
      const fileId = formatId(source.searchParams.get('file_id'))
      const evidenceId = formatId(source.searchParams.get('evidence_id'))
      const partnerId = formatId(source.searchParams.get('partner_id'))
      if (!fileId || !evidenceId || !partnerId) return null
      return { origin: source.origin, fileId, evidenceId, partnerId }
    } catch (e) {
      return null
    }
  }

  function buildMediaStartUrl (streamInfo) {
    if (!streamInfo) return ''
    const url = new URL('/api/v1/media/start', streamInfo.origin)
    url.searchParams.set('partner_id', streamInfo.partnerId)
    url.searchParams.set('evidence_id', streamInfo.evidenceId)
    url.searchParams.set('file_id', streamInfo.fileId)
    return url.toString()
  }

  function buildHlsMasterUrl (streamInfo, streamingSessionToken) {
    if (!streamInfo || !streamingSessionToken) return ''
    const url = new URL('/api/v1/media/hls/master', streamInfo.origin)
    url.searchParams.set('partner_id', streamInfo.partnerId)
    url.searchParams.set('evidence_id', streamInfo.evidenceId)
    url.searchParams.set('file_id', streamInfo.fileId)
    url.searchParams.set('streamingSessionToken', streamingSessionToken)
    url.searchParams.set('autorotate', 'true')
    url.searchParams.set('autoFixPTS', 'true')
    return url.toString()
  }

  function getClipStartPosition (video, masterTime) {
    const mapOffset = (typeof syncPlayerTimeOffsets !== 'undefined' && syncPlayerTimeOffsets && video && syncPlayerTimeOffsets[video.id]) || 0
    const videoStart = new Date(video && video.recordedOn).getTime() + ((video && video._timeOffsetMs) || mapOffset || 0)
    const offset = (Number(masterTime) - videoStart) / 1000
    if (!isFinite(offset) || offset <= 0) return 0
    const duration = Number(video && video.duration)
    return isFinite(duration) && duration > 0 ? Math.min(offset, duration) : offset
  }

  let syncPlayerVideos = []
  let syncPlayerMasterStart = 0
  let syncPlayerMasterEnd = 0
  let syncPlayerPlaying = false
  let syncPlayerRate = 1
  let syncPlayerRAF = null
  let syncPlayerLastTickWall = 0
  let syncPlayerLastTickWallMs = 0  // Date.now() at last tick, for background-tab recovery
  let syncPlayerCurrentMasterTime = 0
  let syncPlayerDocked = true
  // Multiple cameras may be audible at once; this tracks every unmuted video id.
  let syncPlayerAudioVideoIds = new Set()
  let syncPlayerStreamGeneration = 0
  // Per-video manual timestamp offsets (ms). Keyed by video id; persists across
  // refreshes within the same viewer session so adjustments survive re-queuing.
  const syncPlayerTimeOffsets = {}

  // ── Bug fix: advance master clock correctly when returning from a background tab ──
  // requestAnimationFrame is throttled (or completely paused) in background tabs.
  // When the user returns, performance.now() reflects the full real elapsed time,
  // but our dtMs is clamped to 250 ms per tick so the master time lags far behind
  // where the videos actually are. We track a parallel Date.now() wall clock and
  // on visibility-regain we fast-forward the master time to match.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && syncPlayerPlaying) {
      // Calculate how long the tab was actually hidden using Date.now()
      const realElapsedMs = Date.now() - syncPlayerLastTickWallMs
      // Only fast-forward when the gap is significant (> 1 s) to avoid a spurious
      // jump on a brief flicker.
      if (realElapsedMs > 1000) {
        const nextMaster = syncPlayerCurrentMasterTime + realElapsedMs * syncPlayerRate
        const clamped = Math.min(nextMaster, syncPlayerMasterEnd)
        syncPlayerCurrentMasterTime = clamped
        // Reset both wall-clock anchors so the next tick computes a clean delta.
        syncPlayerLastTickWall = performance.now()
        syncPlayerLastTickWallMs = Date.now()
        seekSyncPlayerToMasterTime(clamped)
        setMasterPlayheadTime(clamped, false)
        if (clamped >= syncPlayerMasterEnd) {
          toggleSyncPlayback()
        }
      }
    }
  })

  function isSyncAudioActive (vid) {
    return syncPlayerAudioVideoIds.has(vid)
  }

  // Push the current audio selection onto the rendered <video> elements and buttons.
  function applySyncPlayerAudioMutes () {
    const grid = document.getElementById('sync-player-grid')
    if (!grid) return
    grid.querySelectorAll('.sp-video').forEach(function (vel) {
      vel.muted = !isSyncAudioActive(vel.getAttribute('data-vid'))
    })
    grid.querySelectorAll('.sp-audio-btn').forEach(function (btn) {
      const isAct = isSyncAudioActive(btn.getAttribute('data-audio-vid'))
      btn.classList.toggle('sp-audio-active', isAct)
      btn.innerHTML = isAct ? '&#128266;' : '&#128263;'
      btn.title = isAct ? 'Mute audio for this camera' : 'Unmute audio for this camera (several cameras can play audio at once)'
    })
  }

  function isSyncPlayerOpen () {
    const overlay = document.getElementById('sync-player-overlay')
    return !!(overlay && overlay.style.display === 'flex')
  }

  function applySyncPlayerDockLayout () {
    const overlay = document.getElementById('sync-player-overlay')
    const dockBtn = document.getElementById('sync-player-dock-toggle')
    const tlView = document.getElementById('timeline-view')
    if (!overlay) return

    if (syncPlayerDocked) {
      overlay.style.top = 'auto'
      overlay.style.bottom = '0'
      overlay.style.height = '48vh'
      overlay.style.borderTop = '2px solid #38bdf8'
      overlay.style.boxShadow = '0 -8px 32px rgba(0, 0, 0, 0.6)'
      if (dockBtn) dockBtn.innerHTML = '&#9974; Fullscreen'
      if (tlView && overlay.style.display === 'flex') {
        tlView.style.height = 'calc(52vh - 140px)'
      }
    } else {
      overlay.style.top = '0'
      overlay.style.bottom = '0'
      overlay.style.height = '100%'
      overlay.style.borderTop = 'none'
      overlay.style.boxShadow = 'none'
      if (dockBtn) dockBtn.innerHTML = '&#11036; Dock Split-View'
      if (tlView) {
        tlView.style.height = ''
      }
    }
  }

  function setMasterPlayheadTime (ts, syncWithPlayer) {
    if (!tlLayoutCache) {
      tlPlayheadTime = ts
      return
    }
    const clamped = Math.max(tlLayoutCache.firstTs, Math.min(tlLayoutCache.lastTs, ts))
    tlPlayheadTime = clamped

    const playheadEl = document.getElementById('tl-playhead')
    if (playheadEl) {
      const leftPx = tlLayoutCache.labelW + ((clamped - tlLayoutCache.firstTs) / 1000) * tlLayoutCache.pxPerSec
      playheadEl.style.left = leftPx + 'px'
    }
    const timeEl = document.getElementById('tl-playhead-time')
    if (timeEl) {
      timeEl.textContent = formatRealClock(clamped, !tlLayoutCache.isSameDay)
    }
    const count = countVideosAtTime(tlIntervalsCache, clamped)
    const countEl = document.getElementById('tl-playhead-count')
    if (countEl) {
      countEl.textContent = count + ' rec'
    }
    const selBtn = timelineView.querySelector('[data-action="select-at-playhead"]')
    if (selBtn) {
      selBtn.textContent = 'Select @ Playhead (' + count + ')'
      selBtn.title = 'Activate all videos recording at ' + formatRealClock(clamped, !tlLayoutCache.isSameDay)
    }
    const syncBtn = timelineView.querySelector('[data-action="sync-play"]')
    if (syncBtn && selectedVideoIds.size === 0) {
      syncBtn.textContent = '\u25B6 Queue Active at Playhead (' + count + ')'
    }

    // Highlight bars that are active at the playhead
    timelineView.querySelectorAll('.tl-bar').forEach(function (barEl) {
      const vid = barEl.getAttribute('data-video-id')
      const iv = tlIntervalsCache.find(function (item) { return item.video.id === vid })
      if (iv && clamped >= iv.start && clamped <= iv.end) {
        barEl.classList.add('tl-bar-at-playhead')
      } else {
        barEl.classList.remove('tl-bar-at-playhead')
      }
    })

    if (syncWithPlayer && isSyncPlayerOpen()) {
      seekSyncPlayerToMasterTime(clamped)
    }
  }

  function selectVideosAtTime (ts) {
    if (!tlIntervalsCache || tlIntervalsCache.length === 0) return
    let added = 0
    tlIntervalsCache.forEach(function (iv) {
      if (ts >= iv.start && ts <= iv.end) {
        selectedVideoIds.add(iv.video.id)
        added++
      }
    })
    if (added === 0 && tlIntervalsCache.length > 0) {
      // Find closest video to ts
      let closest = tlIntervalsCache[0]
      let bestDist = Infinity
      tlIntervalsCache.forEach(function (iv) {
        const dist = ts < iv.start ? (iv.start - ts) : (ts > iv.end ? (ts - iv.end) : 0)
        if (dist < bestDist) { bestDist = dist; closest = iv }
      })
      if (closest) {
        selectedVideoIds.add(closest.video.id)
        tlPlayheadTime = closest.start
      }
    }
    renderTimeline()
    if (isSyncPlayerOpen()) refreshSyncPlayerVideos()
  }

  function setupTimelinePlayheadInteractions () {
    const canvas = document.getElementById('tl-canvas')
    if (!canvas || !tlLayoutCache) return

    let draggingPlayhead = false

    function updateFromClientX (clientX) {
      if (!tlLayoutCache) return
      const rect = canvas.getBoundingClientRect()
      const relX = clientX - rect.left
      if (relX < tlLayoutCache.labelW) return
      const secOffset = (relX - tlLayoutCache.labelW) / tlLayoutCache.pxPerSec
      const targetTs = tlLayoutCache.firstTs + secOffset * 1000
      setMasterPlayheadTime(targetTs, true)
    }

    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return
      if (e.target.closest('.tl-bar') || e.target.closest('.tl-lane-label') || e.target.closest('.tl-axis-corner') || e.target.closest('.tl-density-corner')) {
        return
      }
      const rect = canvas.getBoundingClientRect()
      if (e.clientX - rect.left < tlLayoutCache.labelW) return
      e.preventDefault()
      draggingPlayhead = true
      updateFromClientX(e.clientX)

      function onMove (me) {
        if (!draggingPlayhead) return
        updateFromClientX(me.clientX)
      }
      function onUp () {
        draggingPlayhead = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })

    const cap = document.getElementById('tl-playhead-cap')
    if (cap) {
      cap.addEventListener('mousedown', function (e) {
        e.preventDefault()
        e.stopPropagation()
        draggingPlayhead = true
        function onMove (me) {
          if (!draggingPlayhead) return
          updateFromClientX(me.clientX)
        }
        function onUp () {
          draggingPlayhead = false
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })
    }
  }

  function getVideosForSyncReview () {
    // 1. If user explicitly selected 1+ videos, use those
    const selected = tlVideos.filter(function (v) { return selectedVideoIds.has(v.id) && v.recordedOn })
    if (selected.length > 0) return selected

    // 2. Otherwise, if there are videos active at the current playhead time, activate & return them
    if (tlPlayheadTime !== null) {
      const atPlayhead = tlVideos.filter(function (v) {
        const s = new Date(v.recordedOn).getTime()
        const e = s + (v.duration || 0) * 1000
        return tlPlayheadTime >= s && tlPlayheadTime <= e
      })
      if (atPlayhead.length > 0) {
        atPlayhead.forEach(function (v) { selectedVideoIds.add(v.id) })
        return atPlayhead
      }
    }

    // 3. Fallback: all timeline videos
    return tlVideos.filter(function (v) { return v.recordedOn })
  }

  function refreshSyncPlayerVideos () {
    const chosen = tlVideos.filter(function (v) { return selectedVideoIds.has(v.id) && v.recordedOn })
    if (chosen.length === 0) {
      closeSyncPlayer()
      return
    }
    openSyncPlayer(chosen, syncPlayerCurrentMasterTime || tlPlayheadTime)
  }

  function getSyncVideoStatusEl (vel) {
    const wrap = vel && vel.parentElement
    return wrap ? wrap.querySelector('.sp-status-overlay') : null
  }

  function setSyncVideoStatus (vel, message) {
    const statusEl = getSyncVideoStatusEl(vel)
    if (!statusEl || vel._axonStreamError) return
    statusEl.textContent = message
    statusEl.style.display = message ? 'flex' : 'none'
  }

  function setSyncVideoError (vel, message) {
    vel._axonStreamError = message
    const statusEl = getSyncVideoStatusEl(vel)
    if (statusEl) {
      statusEl.textContent = message
      statusEl.style.display = 'flex'
    }
  }

  function destroySyncVideoStream (vel) {
    if (!vel || !vel._axonHls) return
    const hls = vel._axonHls
    vel._axonHls = null
    try { hls.destroy() } catch (e) {}
  }

  function destroySyncPlayerStreams () {
    syncPlayerStreamGeneration++
    const grid = document.getElementById('sync-player-grid')
    if (grid) grid.querySelectorAll('.sp-video').forEach(destroySyncVideoStream)
    // Cancel the session keep-alive when streams are torn down.
    if (syncPlayerSessionKeepaliveTimer) {
      clearInterval(syncPlayerSessionKeepaliveTimer)
      syncPlayerSessionKeepaliveTimer = null
    }
  }

  // ── Session keep-alive ────────────────────────────────────────────────────
  // The Evidence.com streaming session token typically expires in ~10 minutes.
  // We renew every 8 minutes by re-fetching /api/v1/media/start for each active
  // HLS stream. This replaces the manifest URL on the existing hls.js instance
  // so playback is never interrupted.
  let syncPlayerSessionKeepaliveTimer = null
  const SESSION_KEEPALIVE_MS = 8 * 60 * 1000 // 8 minutes

  async function renewSyncPlayerSessions () {
    const grid = document.getElementById('sync-player-grid')
    if (!grid) return
    const generation = syncPlayerStreamGeneration
    for (let idx = 0; idx < syncPlayerVideos.length; idx++) {
      const video = syncPlayerVideos[idx]
      if (!video || !video._videoSrc) continue
      const vel = grid.querySelector('.sp-video[data-index="' + idx + '"]')
      if (!vel || !vel._axonHls || vel._axonStreamError) continue
      const streamInfo = getVideoStreamInfo(video._videoSrc)
      if (!streamInfo) continue
      try {
        const response = await fetch(buildMediaStartUrl(streamInfo), {
          credentials: 'include',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        })
        if (generation !== syncPlayerStreamGeneration) return
        if (!response.ok) continue
        const session = await response.json()
        const newStreamUrl = buildHlsMasterUrl(streamInfo, session && session.streamingSessionToken)
        if (!newStreamUrl || generation !== syncPlayerStreamGeneration) continue
        // Swap the manifest URL on the existing hls.js instance; playback continues.
        const hls = vel._axonHls
        if (hls && hls === vel._axonHls) {
          hls.loadSource(newStreamUrl)
        }
      } catch (e) {
        // Keep-alive failure is non-fatal; the error handler will retry if needed.
      }
    }
  }

  function startSyncPlayerSessionKeepalive () {
    if (syncPlayerSessionKeepaliveTimer) clearInterval(syncPlayerSessionKeepaliveTimer)
    syncPlayerSessionKeepaliveTimer = setInterval(renewSyncPlayerSessions, SESSION_KEEPALIVE_MS)
  }

  function startDirectSyncVideo (vel, video) {
    destroySyncVideoStream(vel)
    vel._axonStreamError = ''
    setSyncVideoStatus(vel, 'Loading direct file…')
    vel.src = video._videoSrc
    vel.load()
  }

  async function initializeSyncVideoStream (vel, video, idx) {
    const generation = syncPlayerStreamGeneration
    let streamInfo = getVideoStreamInfo(video && video._videoSrc)
    const HlsCtor = window.Hls
    const canUseMse = !!(HlsCtor && HlsCtor.isSupported())
    const canUseNativeHls = !!(vel.canPlayType && vel.canPlayType('application/vnd.apple.mpegurl'))

    if (!streamInfo && video && video._link && video._link !== '#') {
      try {
        const linkUrl = new URL(video._link)
        const evId = (linkUrl.searchParams.get('evidence_id') || '').replace(/-/g, '')
        const pid = (linkUrl.searchParams.get('partner_id') || '').replace(/-/g, '')
        if (evId && pid) {
          vel._axonStreamError = ''
          setSyncVideoStatus(vel, 'Resolving file…')
          const detailUrl = new URL('/api/v3/agencies/' + pid + '/evidence/' + evId + '?emitAccessEvent=false', linkUrl.origin)
          const detailResp = await fetch(detailUrl.toString(), {
            credentials: 'include',
            headers: {
              Accept: 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            }
          })
          if (generation !== syncPlayerStreamGeneration || vel.isConnected === false) return
          if (detailResp && detailResp.ok) {
            const detail = await detailResp.json()
            const evidence = detail && detail.data
            let refs = evidence && evidence.relationships && evidence.relationships.files && evidence.relationships.files.data
            if (refs && !Array.isArray(refs)) refs = [refs]
            let chosen = null
            if (Array.isArray(refs)) {
              for (let i = 0; i < refs.length; i++) {
                const ref = refs[i]
                if (!ref || !ref.id) continue
                if (!chosen) chosen = ref
                if (ref.attributes && ref.attributes.fileType === 'MasterCopy') { chosen = ref; break }
              }
            }
            if (chosen && chosen.id) {
              const ownerPid = chosen.partnerId || (evidence && evidence.attributes && evidence.attributes.domain) || pid
              const resolvedStreamUrl = new URL('/api/v1/media/streaming/stream', linkUrl.origin)
              resolvedStreamUrl.searchParams.set('evidence_id', (evidence && evidence.id) || evId)
              resolvedStreamUrl.searchParams.set('file_id', chosen.id)
              resolvedStreamUrl.searchParams.set('partner_id', ownerPid)
              video._videoSrc = resolvedStreamUrl.toString()
              streamInfo = getVideoStreamInfo(video._videoSrc)
            }
          }
        }
      } catch (e) {
        if (generation !== syncPlayerStreamGeneration || vel.isConnected === false) return
      }
    }

    if (!streamInfo && (!video || !video._videoSrc)) {
      vel._axonBuffering = false
      if (typeof setSyncVideoError === 'function') {
        setSyncVideoError(vel, 'Stream URL requires File ID. Run "Fetch Files" on the case page or open directly in Evidence.com.')
      }
      return
    }

    if (!streamInfo || (!canUseMse && !canUseNativeHls)) {
      startDirectSyncVideo(vel, video)
      return
    }

    vel._axonStreamError = ''
    setSyncVideoStatus(vel, 'Starting stream…')

    try {
      const response = await fetch(buildMediaStartUrl(streamInfo), {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      })
      if (!response.ok) throw new Error('Media start returned HTTP ' + response.status)
      const session = await response.json()
      const streamUrl = buildHlsMasterUrl(streamInfo, session && session.streamingSessionToken)
      if (!streamUrl) throw new Error('Media start returned no streaming session token')
      if (generation !== syncPlayerStreamGeneration || vel.isConnected === false) return

      if (canUseMse) {
        const hls = new HlsCtor({
          startPosition: getClipStartPosition(video, syncPlayerCurrentMasterTime),
          xhrSetup: function (xhr) {
            xhr.withCredentials = true
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
          }
        })
        vel._axonHls = hls
        hls.on(HlsCtor.Events.ERROR, function (event, data) {
          if (generation !== syncPlayerStreamGeneration || vel._axonHls !== hls) return
          if (data && data.fatal) {
            // Destroy the stale HLS instance first so initializeSyncVideoStream
            // starts fresh rather than double-attaching.
            destroySyncVideoStream(vel)
            // Count retries so we don't loop forever on a genuine error.
            vel._axonSessionRetries = (vel._axonSessionRetries || 0) + 1
            if (vel._axonSessionRetries <= 3) {
              // Session token likely expired during long playback — renew it.
              setSyncVideoStatus(vel, 'Renewing session…')
              initializeSyncVideoStream(vel, video, idx)
            } else {
              startDirectSyncVideo(vel, video)
            }
          }
        })
        hls.on(HlsCtor.Events.MANIFEST_PARSED, function () {
          if (generation !== syncPlayerStreamGeneration || vel._axonHls !== hls) return
          // Stream is healthy — reset the retry counter so a future expiry gets
          // a fresh set of renewal attempts.
          vel._axonSessionRetries = 0
          positionSingleVideo(vel, idx, syncPlayerCurrentMasterTime, true)
        })
        hls.loadSource(streamUrl)
        hls.attachMedia(vel)
      } else {
        vel.src = streamUrl
        vel.load()
      }
    } catch (e) {
      if (generation !== syncPlayerStreamGeneration || vel.isConnected === false) return
      const reason = e && /^Media start returned/.test(e.message) ? ': ' + e.message : ''
      console.warn('[AxonViewer] HLS startup failed; using direct file' + reason)
      startDirectSyncVideo(vel, video)
    }
  }

  function openSyncPlayer (videos, initialMasterTime) {
    if (!videos || videos.length === 0) return
    syncPlayerVideos = videos.filter(function (v) { return v.recordedOn })
    if (syncPlayerVideos.length === 0) return
    destroySyncPlayerStreams()

    const deviceOwnerByIdentity = buildDeviceOwnerMap(allData && allData.length ? allData : syncPlayerVideos)

    const overlay = document.getElementById('sync-player-overlay')
    const grid = document.getElementById('sync-player-grid')
    const count = syncPlayerVideos.length
    const cols = count === 1 ? 1 : (count <= 4 ? 2 : (count <= 9 ? 3 : 4))
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(240px, 1fr))'

    // Compute master time range across the activated videos
    const starts = syncPlayerVideos.map(function (v) {
      return new Date(v.recordedOn).getTime() + (v._timeOffsetMs || syncPlayerTimeOffsets[v.id] || 0)
    })
    const ends = syncPlayerVideos.map(function (v, i) { return starts[i] + Math.max(1, v.duration || 0) * 1000 })
    syncPlayerMasterStart = Math.min.apply(null, starts)
    syncPlayerMasterEnd = Math.max.apply(null, ends)
    let masterRange = syncPlayerMasterEnd - syncPlayerMasterStart
    if (masterRange <= 0) masterRange = 60000

    // Default audio to first video if not set
    const audioCandidates = new Set(syncPlayerVideos.map(function (v) { return v.id }))
    syncPlayerAudioVideoIds.forEach(function (vid) {
      if (!audioCandidates.has(vid)) syncPlayerAudioVideoIds.delete(vid)
    })
    if (!isSyncPlayerOpen() && syncPlayerAudioVideoIds.size === 0) {
      // Prefer a camera that actually has a playable stream as the initial audio source.
      const defaultAudio = syncPlayerVideos.find(function (v) { return v._videoSrc || (v._link && v._link !== '#') }) || syncPlayerVideos[0]
      syncPlayerAudioVideoIds.add(defaultAudio.id)
    }

    grid.innerHTML = syncPlayerVideos.map(function (v, i) {
      const owner = resolveOwnerName(v, deviceOwnerByIdentity) || v._uploadedBy || 'Unknown'
      const devLabel = v._deviceType ? formatValue('_deviceType', v._deviceType) : (v._deviceMount ? formatValue('_deviceMount', v._deviceMount) : '')
      const isAudioActive = isSyncAudioActive(v.id)
      const hasStream = !!(v._videoSrc || (v._link && v._link !== '#'))
      const videoBody = hasStream
        ? '<div class="sp-video-wrap">' +
            '<video class="sp-video" preload="metadata" data-index="' + i + '" data-vid="' + escAttr(v.id) + '" ' + (isAudioActive ? '' : 'muted') + ' playsinline></video>' +
            '<div class="sp-status-overlay" data-status-for="' + i + '"> Queued</div>' +
          '</div>'
        : '<div class="sp-video-wrap sp-video-missing">' +
            '<div class="sp-missing-msg">' +
              '<div>&#127916; Stream URL requires File ID</div>' +
              '<div style="font-size:10px;color:#64748b;margin-top:4px;">Run "Fetch Files" on the case page or open directly in Evidence.com</div>' +
            '</div>' +
            '<div class="sp-status-overlay" data-status-for="' + i + '">Timeline Sync</div>' +
          '</div>'

      return '<div class="sp-cell" data-cell-index="' + i + '" data-vid="' + escAttr(v.id) + '">' +
        '<div class="sp-cell-header">' +
          '<div class="sp-cell-titles">' +
            '<div class="sp-owner">' + escapeHtml(owner) + (devLabel ? ' <span class="sp-dev-badge">' + escapeHtml(devLabel) + '</span>' : '') + '</div>' +
            '<div class="sp-label" title="' + escAttr(v.title || v.id) + '">' + escapeHtml(v.title || v.id) + '</div>' +
          '</div>' +
          '<div class="sp-cell-actions">' +
            (hasStream ? '<button type="button" class="sp-audio-btn' + (isAudioActive ? ' sp-audio-active' : '') + '" data-audio-vid="' + escAttr(v.id) + '" title="' + (isAudioActive ? 'Mute audio for this camera' : 'Unmute audio for this camera (several cameras can play audio at once)') + '">' + (isAudioActive ? '&#128266;' : '&#128263;') + '</button>' : '') +
            '<button type="button" class="sp-jump-ext-btn" data-jump-index="' + i + '" title="Open on Evidence.com at this timestamp">&#8599;</button>' +
            '<button type="button" class="sp-remove-btn" data-remove-vid="' + escAttr(v.id) + '" title="Deactivate video from sync view">&#10005;</button>' +
          '</div>' +
        '</div>' +
        '<div class="sp-time-bar">' +
          '<span>Rec: ' + escapeHtml(formatRealClock(starts[i], true)) + ' (' + escapeHtml(formatValue('duration', v.duration)) + ')</span>' +
          '<span class="sp-clip-offset" data-offset-for="' + i + '">--:--</span>' +
        '</div>' +
        '<div class="sp-adjust-bar">' +
          '<span class="sp-adjust-label">Offset:</span>' +
          '<button type="button" class="sp-adj-btn" data-adj-vid="' + escAttr(v.id) + '" data-adj-ms="-10000" title="Shift this video 10 seconds earlier in master time">−10s</button>' +
          '<button type="button" class="sp-adj-btn" data-adj-vid="' + escAttr(v.id) + '" data-adj-ms="-1000" title="Shift this video 1 second earlier in master time">−1s</button>' +
          '<span class="sp-adj-display" data-adj-for="' + i + '">±0s</span>' +
          '<button type="button" class="sp-adj-btn" data-adj-vid="' + escAttr(v.id) + '" data-adj-ms="1000" title="Shift this video 1 second later in master time">+1s</button>' +
          '<button type="button" class="sp-adj-btn" data-adj-vid="' + escAttr(v.id) + '" data-adj-ms="10000" title="Shift this video 10 seconds later in master time">+10s</button>' +
          '<button type="button" class="sp-adj-reset-btn" data-adj-vid="' + escAttr(v.id) + '" title="Reset offset to zero">↺</button>' +
        '</div>' +
        videoBody +
        '<div class="sp-clip-progress"><div class="sp-clip-progress-fill" data-prog-for="' + i + '"></div></div>' +
      '</div>'
    }).join('')

    // Render minimap bars under the master scrubber
    const minimap = document.getElementById('sync-player-minimap')
    if (minimap) {
      minimap.innerHTML = syncPlayerVideos.map(function (v, i) {
        const leftPct = Math.max(0, Math.min(100, ((starts[i] - syncPlayerMasterStart) / masterRange) * 100))
        const widthPct = Math.max(0.5, Math.min(100 - leftPct, (((ends[i] - starts[i])) / masterRange) * 100))
        return '<div style="position:absolute;left:' + leftPct.toFixed(2) + '%;width:' + widthPct.toFixed(2) + '%;top:0;bottom:0;background:rgba(56,189,248,0.35);"></div>'
      }).join('')
    }

    overlay.style.display = 'flex'
    applySyncPlayerDockLayout()
    document.getElementById('sync-player-play').textContent = '\u25B6 Play'
    syncPlayerPlaying = false
    if (syncPlayerRAF) { cancelAnimationFrame(syncPlayerRAF); syncPlayerRAF = null }
    document.getElementById('sync-player-speed').textContent = syncPlayerRate + 'x'

    // Determine initial master timestamp: if playhead is inside [start, end], queue right to it
    let startMasterTs = syncPlayerMasterStart
    if (typeof initialMasterTime === 'number' && initialMasterTime >= syncPlayerMasterStart && initialMasterTime <= syncPlayerMasterEnd) {
      startMasterTs = initialMasterTime
    } else if (tlPlayheadTime !== null && tlPlayheadTime >= syncPlayerMasterStart && tlPlayheadTime <= syncPlayerMasterEnd) {
      startMasterTs = tlPlayheadTime
    }
    syncPlayerCurrentMasterTime = startMasterTs

    const initialScrubVal = Math.round(((startMasterTs - syncPlayerMasterStart) / masterRange) * 10000)
    const scrubber = document.getElementById('sync-player-scrubber')
    scrubber.value = Math.max(0, Math.min(10000, initialScrubVal))

    // Wire scrubber input
    scrubber.oninput = function () {
      const val = Number(this.value)
      const masterTs = masterTimeFromScrub(val)
      seekSyncPlayerToMasterTime(masterTs)
      setMasterPlayheadTime(masterTs, false)
    }

    // Wire per-cell actions (toggle audio, jump to Evidence.com at offset, deactivate clip)
    grid.querySelectorAll('.sp-audio-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const vid = this.getAttribute('data-audio-vid')
        // Toggle independently so several cameras can be audible together.
        if (isSyncAudioActive(vid)) syncPlayerAudioVideoIds.delete(vid)
        else syncPlayerAudioVideoIds.add(vid)
        applySyncPlayerAudioMutes()
        if (syncPlayerPlaying && isSyncAudioActive(vid)) {
          // Start this camera right away instead of waiting for the next tick.
          grid.querySelectorAll('.sp-video').forEach(function (vel) {
            if (vel.getAttribute('data-vid') !== vid) return
            positionSingleVideo(vel, Number(vel.dataset.index), syncPlayerCurrentMasterTime, false)
          })
        }
      })
    })

    grid.querySelectorAll('.sp-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const vid = this.getAttribute('data-remove-vid')
        selectedVideoIds.delete(vid)
        renderTimeline()
        refreshSyncPlayerVideos()
      })
    })

    // Wire up the external-link jump button (also account for per-video time offset)
    grid.querySelectorAll('.sp-jump-ext-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = Number(this.getAttribute('data-jump-index'))
        const v = syncPlayerVideos[idx]
        if (!v || !v._link || v._link === '#') return
        const mapOffset = (typeof syncPlayerTimeOffsets !== 'undefined' && syncPlayerTimeOffsets && syncPlayerTimeOffsets[v.id]) || 0
    const videoStart = new Date(v.recordedOn).getTime() + (v._timeOffsetMs || mapOffset || 0)
        const offsetSec = Math.max(0, Math.floor((syncPlayerCurrentMasterTime - videoStart) / 1000))
        const url = v._link + (offsetSec > 0 ? '#t=' + offsetSec : '')
        window.open(url, '_blank')
      })
    })

    // Wire up manual timestamp-offset adjust buttons.
    function applyVideoTimeOffset (vid, deltaMs, reset) {
      const nextOffset = reset ? 0 : ((syncPlayerTimeOffsets[vid] || 0) + deltaMs)
      syncPlayerTimeOffsets[vid] = nextOffset
      const v = syncPlayerVideos.find(function (sv) { return sv.id === vid })
      if (v) v._timeOffsetMs = nextOffset
      // Immediately re-seek all videos so the change is felt right away.
      seekSyncPlayerToMasterTime(syncPlayerCurrentMasterTime)
      // Force-reposition the adjusted video regardless of seeking state.
      if (v) {
        const idx = syncPlayerVideos.indexOf(v)
        const vel = grid.querySelector('.sp-video[data-index="' + idx + '"]')
        if (vel) positionSingleVideo(vel, idx, syncPlayerCurrentMasterTime, true)
      }
    }

    grid.querySelectorAll('.sp-adj-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyVideoTimeOffset(this.getAttribute('data-adj-vid'), Number(this.getAttribute('data-adj-ms')), false)
      })
    })

    grid.querySelectorAll('.sp-adj-reset-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyVideoTimeOffset(this.getAttribute('data-adj-vid'), 0, true)
      })
    })

    // Queue all videos immediately and also when metadata finishes loading
    seekSyncPlayerToMasterTime(startMasterTs)
    setMasterPlayheadTime(startMasterTs, false)

    grid.querySelectorAll('.sp-video').forEach(function (vel) {
      const idx = Number(vel.dataset.index)
      vel._axonBuffering = true
      vel.addEventListener('loadedmetadata', function () {
        positionSingleVideo(vel, idx, syncPlayerCurrentMasterTime, true)
      })
      vel.addEventListener('seeked', function () {
        vel._axonBuffering = vel.readyState < 3
        // Re-anchor only this video to the current master time; do not
        // disturb other videos that are already playing at the right position.
        positionSingleVideo(vel, idx, syncPlayerCurrentMasterTime, true)
        // Update UI indicators for all videos.
        seekSyncPlayerToMasterTime(syncPlayerCurrentMasterTime)
      })
      vel.addEventListener('canplay', function () {
        vel._axonBuffering = false
        // Re-anchor only this video; others are unaffected.
        positionSingleVideo(vel, idx, syncPlayerCurrentMasterTime, true)
      })
      vel.addEventListener('playing', function () {
        vel._axonBuffering = false
        // Verify position on resume; correct if drift has accumulated.
        positionSingleVideo(vel, idx, syncPlayerCurrentMasterTime, true)
      })
      vel.addEventListener('waiting', function () {
        vel._axonBuffering = true
        setSyncVideoStatus(vel, 'Buffering…')
      })
      vel.addEventListener('error', function () {
        if (vel._axonHls) return
        const v = syncPlayerVideos[idx]
        const info = getVideoStreamInfo(v && v._videoSrc)
        if (info && !vel._axonTriedStreamEndpoint && String(vel.src || '').indexOf('/api/v1/media/streaming/stream') === -1) {
          vel._axonTriedStreamEndpoint = true
          const directStream = new URL('/api/v1/media/streaming/stream', info.origin)
          directStream.searchParams.set('evidence_id', info.evidenceId)
          directStream.searchParams.set('file_id', info.fileId)
          directStream.searchParams.set('partner_id', info.partnerId)
          vel.src = directStream.toString()
          vel.load()
          return
        }
        vel._axonBuffering = false
        setSyncVideoError(vel, 'Stream unavailable or session expired. Use the ↗ button above to open this clip in Evidence.com.')
      })
      initializeSyncVideoStream(vel, syncPlayerVideos[idx], idx)
    })

    // Start the session keep-alive so tokens are renewed before they expire.
    startSyncPlayerSessionKeepalive()
  }

  function closeSyncPlayer () {
    destroySyncPlayerStreams()
    syncPlayerPlaying = false
    if (syncPlayerRAF) { cancelAnimationFrame(syncPlayerRAF); syncPlayerRAF = null }
    const overlay = document.getElementById('sync-player-overlay')
    if (overlay) overlay.style.display = 'none'
    const tlView = document.getElementById('timeline-view')
    if (tlView) tlView.style.height = ''
    const grid = document.getElementById('sync-player-grid')
    if (grid) grid.innerHTML = ''
    syncPlayerVideos = []
  }

  function masterTimeFromScrub (val) {
    const range = Math.max(1000, syncPlayerMasterEnd - syncPlayerMasterStart)
    return syncPlayerMasterStart + (val / 10000) * range
  }

  function positionSingleVideo (vel, idx, masterTime, forceSeek) {
    const v = syncPlayerVideos[idx]
    if (!v || !vel) return

    // During playback ticks (forceSeek=false), skip videos that are mid-seek or
    // mid-buffer so we don't queue a second seek on top of an in-flight one.
    // They will re-anchor themselves via their 'seeked'/'canplay'/'playing'
    // events once the browser resolves the current seek/buffer.
    if (!forceSeek && (vel.seeking || vel._axonBuffering)) return

    const mapOffset = (typeof syncPlayerTimeOffsets !== 'undefined' && syncPlayerTimeOffsets && syncPlayerTimeOffsets[v.id]) || 0
    const videoStart = new Date(v.recordedOn).getTime() + (v._timeOffsetMs || mapOffset || 0)
    const dur = (vel.duration && isFinite(vel.duration) && vel.duration > 0) ? vel.duration : (v.duration || 0)
    const seekTime = (masterTime - videoStart) / 1000

    if (seekTime < 0 || seekTime > dur) {
      if (!vel.paused) vel.pause()
      const clampedEdge = seekTime < 0 ? 0 : Math.max(0, dur - 0.05)
      if (forceSeek && vel.readyState >= 1 && Math.abs(vel.currentTime - clampedEdge) > 0.5) {
        try { vel.currentTime = clampedEdge } catch (e) {}
      }
    } else {
      const target = Math.max(0, Math.min(seekTime, dur))
      const drift = vel.currentTime - target // signed: positive means video is ahead
      const absDrift = Math.abs(drift)
      const threshold = forceSeek ? 0.08 : 0.45

      if (absDrift > threshold && (!vel.seeking || forceSeek)) {
        if (!forceSeek && absDrift <= 3 && drift > 0 && syncPlayerPlaying) {
          // Video is slightly ahead of master: slow it down briefly to let master
          // catch up rather than issuing a disruptive hard seek.
          vel.playbackRate = Math.max(0.5, syncPlayerRate * 0.75)
        } else if (!forceSeek && absDrift <= 3 && drift < 0 && syncPlayerPlaying) {
          // Video is slightly behind master: speed it up briefly to catch up.
          vel.playbackRate = Math.min(4, syncPlayerRate * 1.5)
        } else {
          // Large drift or forced scrub: hard seek to correct position.
          vel.playbackRate = syncPlayerRate
          try { vel.currentTime = target } catch (e) {}
        }
      } else {
        // In range: restore normal rate.
        if (vel.playbackRate !== syncPlayerRate) vel.playbackRate = syncPlayerRate
      }

      if (syncPlayerPlaying && vel.paused && !vel.seeking) {
        vel.playbackRate = syncPlayerRate
        vel.play().catch(function () {})
      } else if (!syncPlayerPlaying && !vel.paused) {
        vel.pause()
      }
    }
  }

  function seekSyncPlayerToMasterTime (masterTime) {
    if (syncPlayerVideos.length === 0) return
    const clamped = Math.max(syncPlayerMasterStart, Math.min(syncPlayerMasterEnd, masterTime))
    syncPlayerCurrentMasterTime = clamped

    const range = Math.max(1000, syncPlayerMasterEnd - syncPlayerMasterStart)
    const scrubVal = Math.round(((clamped - syncPlayerMasterStart) / range) * 10000)
    const scrubber = document.getElementById('sync-player-scrubber')
    if (scrubber && Number(scrubber.value) !== scrubVal) {
      scrubber.value = Math.max(0, Math.min(10000, scrubVal))
    }

    const grid = document.getElementById('sync-player-grid')
    let activeNowCount = 0

    syncPlayerVideos.forEach(function (v, idx) {
      const mapOffset = (typeof syncPlayerTimeOffsets !== 'undefined' && syncPlayerTimeOffsets && syncPlayerTimeOffsets[v.id]) || 0
    const videoStart = new Date(v.recordedOn).getTime() + (v._timeOffsetMs || mapOffset || 0)
      const dur = v.duration || 0
      const videoEnd = videoStart + dur * 1000
      const cell = grid ? grid.querySelector('[data-cell-index="' + idx + '"]') : null
      const statusEl = grid ? grid.querySelector('[data-status-for="' + idx + '"]') : null
      const offsetEl = grid ? grid.querySelector('[data-offset-for="' + idx + '"]') : null
      const progEl = grid ? grid.querySelector('[data-prog-for="' + idx + '"]') : null
      const vel = grid ? grid.querySelector('.sp-video[data-index="' + idx + '"]') : null

      const relSec = (clamped - videoStart) / 1000
      const isActiveAtTime = clamped >= videoStart && clamped <= videoEnd

      if (isActiveAtTime) {
        activeNowCount++
        if (cell) cell.classList.add('sp-cell-active')
        if (cell) cell.classList.remove('sp-cell-waiting')
        if (statusEl && v._videoSrc) {
          if (vel && vel._axonStreamError) {
            statusEl.textContent = vel._axonStreamError
            statusEl.style.display = 'flex'
          } else if (vel && vel.readyState >= 3 && !vel.seeking && !vel._axonBuffering) {
            statusEl.style.display = 'none'
          } else if (vel) {
            statusEl.textContent = vel.seeking ? 'Seeking…' : 'Buffering…'
            statusEl.style.display = 'flex'
          }
        } else if (statusEl) {
          statusEl.style.display = 'flex'
          statusEl.textContent = 'Active @ +' + formatSeconds(relSec)
        }
        if (offsetEl) offsetEl.textContent = '+' + formatSeconds(relSec) + ' / ' + formatSeconds(dur)
        if (progEl) progEl.style.width = (dur > 0 ? Math.min(100, Math.max(0, (relSec / dur) * 100)) : 0).toFixed(1) + '%'
      } else {
        if (cell) cell.classList.remove('sp-cell-active')
        if (cell) cell.classList.add('sp-cell-waiting')
        if (statusEl) {
          statusEl.style.display = 'flex'
          if (clamped < videoStart) {
            const waitSec = Math.ceil((videoStart - clamped) / 1000)
            statusEl.textContent = 'Starts in ' + formatSeconds(waitSec) + ' (' + formatRealClock(videoStart, false) + ')'
          } else {
            statusEl.textContent = 'Ended at ' + formatRealClock(videoEnd, false)
          }
        }
        if (offsetEl) {
          offsetEl.textContent = clamped < videoStart ? 'Waiting\u2026' : 'Ended'
        }
        if (progEl) progEl.style.width = (clamped < videoStart ? '0%' : '100%')
      }

      // Update the manual offset display badge for this cell.
      const adjEl = grid ? grid.querySelector('[data-adj-for="' + idx + '"]') : null
      if (adjEl) {
        const offMs = v._timeOffsetMs || (typeof syncPlayerTimeOffsets !== 'undefined' && syncPlayerTimeOffsets && syncPlayerTimeOffsets[v.id]) || 0
        adjEl.textContent = offMs === 0 ? '±0s' : (offMs > 0 ? '+' : '') + (offMs / 1000).toFixed(1) + 's'
        adjEl.style.color = offMs === 0 ? '#64748b' : '#fbbf24'
      }

      if (vel) {
        positionSingleVideo(vel, idx, clamped, !syncPlayerPlaying)
      }
    })

    updateSyncTimeDisplay(clamped, activeNowCount)
  }

  function updateSyncTimeDisplay (masterTime, activeNowCount) {
    const offset = (masterTime - syncPlayerMasterStart) / 1000
    const range = (syncPlayerMasterEnd - syncPlayerMasterStart) / 1000
    const timeEl = document.getElementById('sync-player-time')
    if (timeEl) {
      timeEl.textContent = '+' + formatSeconds(offset) + ' / ' + formatSeconds(range)
    }
    const realClockEl = document.getElementById('sync-player-realclock')
    if (realClockEl) {
      realClockEl.textContent = formatRealClock(masterTime, true)
    }
    const badgeEl = document.getElementById('sync-player-active-badge')
    if (badgeEl) {
      badgeEl.textContent = activeNowCount + ' / ' + syncPlayerVideos.length + ' playing @ time'
      badgeEl.style.borderColor = activeNowCount > 0 ? '#38bdf8' : '#334155'
      badgeEl.style.color = activeNowCount > 0 ? '#38bdf8' : '#94a3b8'
    }
  }

  function formatSeconds (s) {
    if (s < 0 || isNaN(s)) s = 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    if (h > 0) {
      return h + ':' + m.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0')
    }
    return m.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0')
  }

  function hasPendingSyncVideoWork () {
    const grid = document.getElementById('sync-player-grid')
    if (!grid) return false

    for (let idx = 0; idx < syncPlayerVideos.length; idx++) {
      const video = syncPlayerVideos[idx]
      if (!video._videoSrc) continue
      const mapOffset = (typeof syncPlayerTimeOffsets !== 'undefined' && syncPlayerTimeOffsets && syncPlayerTimeOffsets[video.id]) || 0
      const videoStart = new Date(video.recordedOn).getTime() + (video._timeOffsetMs || mapOffset || 0)
      const videoEnd = videoStart + (video.duration || 0) * 1000
      if (syncPlayerCurrentMasterTime < videoStart || syncPlayerCurrentMasterTime > videoEnd) continue
      const vel = grid.querySelector('.sp-video[data-index="' + idx + '"]')
      if (!vel || vel._axonStreamError) continue
      if (vel.readyState < 3 || vel.seeking || vel._axonBuffering) return true
    }
    return false
  }

  function toggleSyncPlayback () {
    syncPlayerPlaying = !syncPlayerPlaying
    const playBtn = document.getElementById('sync-player-play')
    if (playBtn) playBtn.textContent = syncPlayerPlaying ? '\u23F8 Pause' : '\u25B6 Play'
    const grid = document.getElementById('sync-player-grid')
    if (!grid) return

    if (syncPlayerPlaying) {
      if (syncPlayerCurrentMasterTime >= syncPlayerMasterEnd) {
        syncPlayerCurrentMasterTime = syncPlayerMasterStart
      }
      applySyncPlayerAudioMutes()
      grid.querySelectorAll('.sp-video').forEach(function (vel) {
        vel.playbackRate = syncPlayerRate
        positionSingleVideo(vel, Number(vel.dataset.index), syncPlayerCurrentMasterTime, false)
      })
      syncPlayerLastTickWall = performance.now()
      syncPlayerLastTickWallMs = Date.now()
      tickLoop()
    } else {
      if (syncPlayerRAF) { cancelAnimationFrame(syncPlayerRAF); syncPlayerRAF = null }
      grid.querySelectorAll('.sp-video').forEach(function (vel) { vel.pause() })
    }
  }

  document.getElementById('sync-player-close').addEventListener('click', closeSyncPlayer)
  document.getElementById('sync-player-play').addEventListener('click', toggleSyncPlayback)

  const dockToggleBtn = document.getElementById('sync-player-dock-toggle')
  if (dockToggleBtn) {
    dockToggleBtn.addEventListener('click', function () {
      syncPlayerDocked = !syncPlayerDocked
      applySyncPlayerDockLayout()
    })
  }

  const stepBackBtn = document.getElementById('sync-player-step-back')
  if (stepBackBtn) {
    stepBackBtn.addEventListener('click', function () {
      const nextTs = (syncPlayerCurrentMasterTime || syncPlayerMasterStart) - 5000
      seekSyncPlayerToMasterTime(nextTs)
      setMasterPlayheadTime(syncPlayerCurrentMasterTime, false)
    })
  }

  const stepFwdBtn = document.getElementById('sync-player-step-fwd')
  if (stepFwdBtn) {
    stepFwdBtn.addEventListener('click', function () {
      const nextTs = (syncPlayerCurrentMasterTime || syncPlayerMasterStart) + 5000
      seekSyncPlayerToMasterTime(nextTs)
      setMasterPlayheadTime(syncPlayerCurrentMasterTime, false)
    })
  }

  function tickLoop () {
    if (!syncPlayerPlaying) return
    const now = performance.now()
    const dtMs = Math.max(0, Math.min(250, now - (syncPlayerLastTickWall || now)))
    syncPlayerLastTickWall = now
    syncPlayerLastTickWallMs = Date.now()

    // Always advance the master clock with wall-clock time so videos that are
    // playing freely stay anchored to real time. Buffering/seeking videos are
    // skipped inside seekSyncPlayerToMasterTime so they don't get re-seeked
    // while their previous seek is still in flight.
    const nextMaster = syncPlayerCurrentMasterTime + dtMs * syncPlayerRate
    if (nextMaster >= syncPlayerMasterEnd) {
      seekSyncPlayerToMasterTime(syncPlayerMasterEnd)
      setMasterPlayheadTime(syncPlayerMasterEnd, false)
      toggleSyncPlayback()
      return
    }

    seekSyncPlayerToMasterTime(nextMaster)
    setMasterPlayheadTime(nextMaster, false)

    syncPlayerRAF = requestAnimationFrame(tickLoop)
  }

  document.getElementById('sync-player-slower').addEventListener('click', function () {
    const rates = [0.25, 0.5, 0.75, 1, 1.5, 2, 4]
    let idx = rates.indexOf(syncPlayerRate)
    if (idx > 0) idx--
    syncPlayerRate = rates[idx]
    document.getElementById('sync-player-speed').textContent = syncPlayerRate + 'x'
    const grid = document.getElementById('sync-player-grid')
    if (grid) grid.querySelectorAll('.sp-video').forEach(function (vel) { vel.playbackRate = syncPlayerRate })
  })

  document.getElementById('sync-player-faster').addEventListener('click', function () {
    const rates = [0.25, 0.5, 0.75, 1, 1.5, 2, 4]
    let idx = rates.indexOf(syncPlayerRate)
    if (idx < rates.length - 1) idx++
    syncPlayerRate = rates[idx]
    document.getElementById('sync-player-speed').textContent = syncPlayerRate + 'x'
    const grid = document.getElementById('sync-player-grid')
    if (grid) grid.querySelectorAll('.sp-video').forEach(function (vel) { vel.playbackRate = syncPlayerRate })
  })

  // Keyboard shortcuts for Sync Player & Timeline
  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
      if (e.key !== 'Escape') return
    }
    if (e.key === 'Escape') {
      if (isSyncPlayerOpen()) {
        closeSyncPlayer()
      }
      if (logsModal && logsModal.style.display === 'flex') {
        logsModal.style.display = 'none'
      }
      return
    }
    if (isSyncPlayerOpen()) {
      if (e.key === ' ') {
        e.preventDefault()
        toggleSyncPlayback()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const step = e.shiftKey ? 30000 : 5000
        seekSyncPlayerToMasterTime(syncPlayerCurrentMasterTime - step)
        setMasterPlayheadTime(syncPlayerCurrentMasterTime, false)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 30000 : 5000
        seekSyncPlayerToMasterTime(syncPlayerCurrentMasterTime + step)
        setMasterPlayheadTime(syncPlayerCurrentMasterTime, false)
      }
    }
  })

  // ── Storage change listener (Live Updates) ─────────────────
  let reloadTimer = null
  let collectionsReloadTimer = null

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local') return
      const keys = Object.keys(changes)

      // If collections list changed
      if (keys.indexOf('axon_collections') !== -1) {
        clearTimeout(collectionsReloadTimer)
        collectionsReloadTimer = setTimeout(function () {
          loadCollections(true)
        }, 400)
      }

      // If active collection data changed
      if (selectedCollectionId) {
        const prefix = 'axon_collection_' + selectedCollectionId + '_'
        const hasCollectionChange = keys.some(function (k) { return k.indexOf(prefix) === 0 })
        if (hasCollectionChange) {
          clearTimeout(reloadTimer)
          reloadTimer = setTimeout(function () {
            loadEvidence(selectedCollectionId, true)
          }, 350)
        }
      }
    })
  }

  // ── Hash navigation ────────────────────────────────────────
  window.addEventListener('hashchange', function () {
    const hash = window.location.hash
    if (hash && hash.indexOf('#collectionId=') === 0) {
      const newId = hash.replace('#collectionId=', '')
      if (newId && newId !== selectedCollectionId) {
        collectionSelect.value = newId
        const col = cachedCollections.find(function (c) { return c.id === newId })
        updateCaseSearchDisplay(col)
        loadEvidence(newId)
      }
    }
  })

  // ── Diagnostics / Logs Modal ───────────────────────────────
  const logsModal = document.getElementById('logs-modal')
  const btnLogs = document.getElementById('btn-logs')
  const btnCloseLogs = document.getElementById('btn-close-logs')
  const btnCopyLogs = document.getElementById('btn-copy-logs')
  const btnClearLogs = document.getElementById('btn-clear-logs')
  const logsContent = document.getElementById('logs-content')
  const logsCountBadge = document.getElementById('logs-count-badge')

  async function refreshLogs () {
    if (!logsContent) return
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'get-logs' })
      const logs = (resp && resp.logs) ? resp.logs : []
      if (logsCountBadge) logsCountBadge.textContent = logs.length + ' entries'
      if (logs.length === 0) {
        logsContent.innerHTML = '<span style="color:#64748b;">No log entries recorded yet.</span>'
        return
      }
      logsContent.innerHTML = logs.map(function (entry) {
        const time = entry.time ? new Date(entry.time).toLocaleTimeString() : ''
        let color = '#94a3b8'
        if (entry.level === 'ERROR') color = '#f87171'
        else if (entry.level === 'WARN') color = '#fbbf24'
        else if (entry.level === 'INFO') color = '#38bdf8'
        const cat = entry.cat ? '[' + entry.cat + '] ' : ''
        return '<span style="color:#475569;">' + time + ' </span>' +
          '<span style="color:' + color + ';font-weight:600;">[' + entry.level + '] </span>' +
          '<span style="color:#cbd5e1;">' + escapeHtml(cat + entry.msg) + '</span>'
      }).join('\n')
      logsContent.scrollTop = logsContent.scrollHeight
    } catch (e) {
      logsContent.textContent = 'Failed to load logs: ' + e.message
    }
  }

  if (btnLogs) {
    btnLogs.addEventListener('click', function () {
      if (logsModal) {
        logsModal.style.display = 'flex'
        refreshLogs()
      }
    })
  }
  if (btnCloseLogs) {
    btnCloseLogs.addEventListener('click', function () {
      if (logsModal) logsModal.style.display = 'none'
    })
  }
  if (logsModal) {
    logsModal.addEventListener('click', function (e) {
      if (e.target === logsModal) logsModal.style.display = 'none'
    })
  }
  if (btnCopyLogs) {
    btnCopyLogs.addEventListener('click', async function () {
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'get-logs' })
        const logs = (resp && resp.logs) ? resp.logs : []
        const text = logs.map(function (e) {
          return '[' + e.time + '] [' + e.level + '] [' + e.cat + '] ' + e.msg
        }).join('\n')
        await navigator.clipboard.writeText(text)
        const oldText = btnCopyLogs.textContent
        btnCopyLogs.textContent = 'Copied!'
        setTimeout(function () { btnCopyLogs.textContent = oldText }, 1500)
      } catch (e) {
        alert('Copy failed: ' + e.message)
      }
    })
  }
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', async function () {
      if (!confirm('Clear all diagnostic logs?')) return
      try {
        await chrome.runtime.sendMessage({ action: 'clear-logs' })
        refreshLogs()
      } catch (e) {}
    })
  }

  window.__axonSyncPlay = function () {
    if (tlVideos.length === 0) return
    const videosToReview = getVideosForSyncReview()
    renderTimeline()
    openSyncPlayer(videosToReview, tlPlayheadTime)
  }

  window.__axonZoom = function (dir) {
    const levels = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16]
    let idx = levels.indexOf(tlZoom)
    if (idx < 0) idx = 4 // default 1x
    idx += dir
    if (idx < 0) idx = 0
    if (idx >= levels.length) idx = levels.length - 1
    tlZoom = levels[idx]
    doRender()
  }

  window.__axonJumpDate = function (offset) {
    if (!offset) return
    const scroll = document.getElementById('tl-scroll')
    if (scroll) scroll.scrollLeft = Number(offset) + 60
  }

  loadCollections()
})()

window.__axonSlideshow = (function () {
  let overlay = null; let currentUrls = []; let currentIndex = -1
  return function (startUrl) {
    const urls = []
    document.querySelectorAll('#table-body td:first-child img, .gallery-img').forEach(function (img) {
      if (img.src && img.style.display !== 'none' && img.parentElement.style.display !== 'none') urls.push(img.src)
    })
    if (urls.length === 0) return
    currentUrls = urls
    currentIndex = currentUrls.indexOf(startUrl)
    if (currentIndex < 0) currentIndex = 0
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = '__axon_slideshow'
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;'
      overlay.innerHTML = '<img id=\"__axon_slide_img\" style=\"max-width:90%;max-height:80%;object-fit:contain;border-radius:8px;\"><div id=\"__axon_slide_title\" style=\"color:#e2e8f0;margin-top:12px;font-family:system-ui;font-size:14px;\"></div><div style=\"position:absolute;top:16px;right:20px;color:#fff;font-size:24px;cursor:pointer;z-index:1;\" onclick=\"document.getElementById(\'__axon_slideshow\').remove();window.__axonSlideshow.overlay=null;\">\u00d7</div>'
      document.body.appendChild(overlay)
    }
    overlay.style.display = 'flex'
    function show () { document.getElementById('__axon_slide_img').src = currentUrls[currentIndex]; document.getElementById('__axon_slide_title').textContent = (currentIndex + 1) + ' / ' + currentUrls.length }
    overlay.onclick = function (e) { if (e.target === overlay) overlay.style.display = 'none' }
    document.onkeydown = function (e) {
      if (overlay.style.display === 'flex') {
        if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % currentUrls.length; show() }
        if (e.key === 'ArrowLeft') { currentIndex = (currentIndex - 1 + currentUrls.length) % currentUrls.length; show() }
        if (e.key === 'Escape') overlay.style.display = 'none'
      }
    }
    show()
  }
})()
