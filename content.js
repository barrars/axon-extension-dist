(function() {
  'use strict';

  var scanning = false;
  var ready = false;
  var stats = null;
  var pauseBtnPaused = false;
  var currentPhase = null; // 'pagination' | 'files' | 'pages' | 'thumbs'
  var activeTasks = { files: null, pages: null, thumbs: null };
  var existingCollection = null;
  var currentCollectionId = null;
  var detailLastIndex = 0;
  var detailLastTotal = 0;
  var caseLabel = null;

  function extractCaseLabel() {
    var labels = document.querySelectorAll('dt[class*="spark__label"]');
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].textContent.trim() === 'CASE ID') {
        var dd = labels[i].nextElementSibling;
        if (dd && dd.matches('dd[class*="spark__data"]')) {
          return dd.textContent.trim();
        }
        var parent = labels[i].parentElement;
        if (parent) {
          dd = parent.querySelector('dd[class*="spark__data"]');
          if (dd) return dd.textContent.trim();
        }
      }
    }
    return null;
  }

  function buildLevelStatus(sl) {
    var parts = [];
    parts.push('Initial' + (sl.initial ? ' ✓' : ' ✗'));
    if (sl.initial) {
      parts.push('Files' + (sl.files ? ' ✓' : ' ✗'));
      parts.push('Pages' + (sl.pages ? ' ✓' : ' ✗'));
      parts.push('Thumbs' + (sl.thumbs ? ' ✓' : ' ✗'));
    }
    return parts.join('  ');
  }

  function showButtonsForLevels(sl) {
    if (!sl.files) showFetchFilesBtn();
    if (!sl.pages) showPageCountBtn();
    if (!sl.thumbs) showThumbnailCacheBtn();
  }

  function getEffectiveCollectionId() {
    return (existingCollection && existingCollection.collectionId) || currentCollectionId || null;
  }

  function updateMultiTaskStatus() {
    if (scanning && currentPhase === 'pagination') return;
    var parts = [];
    if (activeTasks.files) parts.push('Files: ' + activeTasks.files);
    if (activeTasks.pages) parts.push('Pages: ' + activeTasks.pages);
    if (activeTasks.thumbs) parts.push('Thumbs: ' + activeTasks.thumbs);
    if (parts.length > 0) {
      setStatus('Fetching ' + parts.join(' | '));
      showBar();
    }
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || msg.source !== 'axon-intercept') return;
    console.log('[AxonExt-Bridge] received:', msg.type, JSON.stringify(msg.payload).slice(0, 150));
    handleEvent(msg.type, msg.payload);
  });

  function handleEvent(type, payload) {
    var cid = getEffectiveCollectionId();
    switch (type) {
      case 'ready-to-scrape':
        if (scanning) {
          console.log('[AxonExt-Bridge] Scrape currently running, ignoring new ready-to-scrape');
          break;
        }
        if (existingCollection && existingCollection.collectionId) {
          console.log('[AxonExt-Bridge] Already recognized existing collection, skipping ready-to-scrape');
          break;
        }
        if (!caseLabel) caseLabel = extractCaseLabel();
        chrome.runtime.sendMessage({
          action: 'start-collection',
          payload: payload,
          pageUrl: window.location.href,
          caseLabel: caseLabel,
          collectionKey: (payload && payload.collectionKey) || null
        }).then(async function(resp) {
          if (!resp || resp.error) {
            setStatus('Could not start collection' + (resp && resp.error ? ': ' + resp.error : '. Reload the page and retry.'));
          } else if (resp.alreadyComplete) {
            var cr = await chrome.runtime.sendMessage({ action: 'check-case', url: window.location.href });
            var col = (cr && cr.collection) ? cr.collection : resp;
            var sl = col.scrapeLevels || { initial: false, files: false, pages: false, thumbs: false };
            if (!caseLabel && col.caseLabel) caseLabel = col.caseLabel;
            currentCollectionId = col.id;
            existingCollection = { collectionId: col.id, count: col.count };
            scanning = false; ready = true;
            var prefix = caseLabel ? caseLabel + ': ' : '';
            setStatus(prefix + 'Already scraped: ' + col.count + ' records  ' + buildLevelStatus(sl));
            showViewBtn();
            showReScrapeBtn();
            showButtonsForLevels(sl);
            loadStateForIntercept(col.id);
            console.log('[AxonExt-Bridge] Collection already complete, scrapeLevels:', JSON.stringify(sl));
          } else {
            existingCollection = null;
            currentCollectionId = resp ? resp.collectionId : null;
            var labelPart = caseLabel ? 'Scrape ' + caseLabel + ': ' : '';
            if (payload.totalCount === 0) {
              setStatus(labelPart + '0 records in this case');
            } else {
              setStatus(labelPart + payload.totalCount + ' records across ' + payload.totalPages + ' pages');
              showScrapeBtn();
            }
          }
        }).catch(function(err) {
          console.error('[AxonExt-Bridge] start-collection error:', err);
          setStatus('Could not reach extension background — reload the extension and refresh this page.');
        });
        break;

      case 'pagination-started':
        scanning = true; currentPhase = 'pagination';
        setStatus('Collecting\u2026 Page 1 of ' + payload.totalPages);
        showBar(); showPauseBtn();
        break;
      case 'pagination-progress':
        chrome.runtime.sendMessage({ action: 'collection-progress', collectionId: currentCollectionId, payload: payload }).catch(function(){});
        setStatus('Collecting\u2026 Page ' + payload.page + ' of ' + payload.totalPages);
        setProgress(payload.page / payload.totalPages);
        break;
      case 'page-data':
        chrome.runtime.sendMessage({ action: 'store-page-data', collectionId: currentCollectionId, payload: payload }).catch(function(err){
          console.error('[AxonExt-Bridge] store-page-data error:', err);
        });
        break;
      case 'pagination-complete':
        currentCollectionId = currentCollectionId || (payload && payload.collectionId);
        existingCollection = { collectionId: currentCollectionId, count: payload.collected };
        chrome.runtime.sendMessage({
          action: 'collection-complete',
          collectionId: currentCollectionId,
          payload: { collected: payload.collected, totalCount: payload.totalCount, baseUrl: payload.baseUrl, pageUrl: window.location.href, collectionId: currentCollectionId }
        }).catch(function(err){
          console.error('[AxonExt-Bridge] collection-complete error:', err);
        });
        scanning = false; ready = true; stats = payload; currentPhase = null;
        setStatus('Done. ' + payload.collected + ' records collected. Fetching file details\u2026');
        hideBar();
        showReScrapeBtn(); showViewBtn();
        showFetchFilesBtn();
        showPageCountBtn();
        showThumbnailCacheBtn();
        // Auto-trigger file detail fetch after scrape
        window.postMessage({ source: 'axon-extension', action: 'start-files-fetch', resumeIndex: 0 }, '*');
        break;
      case 'pagination-paused':
        chrome.runtime.sendMessage({ action: 'collection-paused', collectionId: currentCollectionId, payload: payload }).catch(function(){});
        setStatus('Paused');
        hideBar();
        break;
      case 'pagination-cancelled':
        chrome.runtime.sendMessage({ action: 'cancel-collection', collectionId: currentCollectionId, payload: payload }).catch(function(){});
        scanning = false; currentPhase = null;
        setStatus('Cancelled'); hideBar();
        break;
      case 'pagination-stopped':
        scanning = false; currentPhase = null;
        setStatus('Stopped: ' + (payload.message || ''));
        hideBar();
        break;
      case 'pagination-error':
        console.error('[AxonExt-Bridge] Pagination error on page ' + payload.page + ':', payload.error);
        setStatus('Error on page ' + payload.page + ': ' + payload.error);
        chrome.runtime.sendMessage({
          action: 'log-event',
          level: 'error',
          context: 'Bridge',
          message: 'Pagination error on page ' + payload.page + ': ' + payload.error,
          details: payload
        }).catch(function(){});
        break;
      case 'pagination-status':
        if (payload && payload.pagination && payload.pagination.active) {
          var p = payload.pagination;
          setStatus('Collecting\u2026 Page ' + p.page + ' of ' + p.totalPages + ' (' + p.collected + '/' + p.totalCount + ')');
          setProgress(p.page / p.totalPages);
          showBar();
        } else if (payload && (payload.files?.active || payload.pages?.active || payload.thumbs?.active)) {
          if (payload.files?.active) activeTasks.files = payload.files.fetched + '/' + payload.files.total;
          if (payload.pages?.active) activeTasks.pages = payload.pages.fetched + '/' + payload.pages.total;
          if (payload.thumbs?.active) activeTasks.thumbs = payload.thumbs.fetched + '/' + payload.thumbs.total;
          updateMultiTaskStatus();
        }
        break;

      case 'file-data':
        chrome.runtime.sendMessage({ action: 'store-file-data', collectionId: cid, payload: payload }).catch(function(err){
          console.error('[AxonExt-Bridge] store-file-data error:', err);
        });
        break;
      case 'folder-data':
        chrome.runtime.sendMessage({ action: 'store-folder-data', collectionId: cid, payload: payload }).catch(function(err){
          console.error('[AxonExt-Bridge] store-folder-data error:', err);
        });
        break;
      case 'files-fetch-started':
        scanning = true; currentPhase = 'files';
        activeTasks.files = (payload.fetched || 0) + '/' + payload.total;
        updateMultiTaskStatus();
        showBar(); showPauseBtn();
        break;
      case 'files-fetch-progress':
        activeTasks.files = payload.fetched + '/' + payload.total;
        updateMultiTaskStatus();
        setProgress(payload.fetched / payload.total);
        break;
      case 'files-fetch-complete':
        activeTasks.files = null;
        hideFetchFilesBtn();
        chrome.runtime.sendMessage({ action: 'files-fetch-done', collectionId: cid }).catch(function(){});
        if (!activeTasks.pages && !activeTasks.thumbs) {
          scanning = false; currentPhase = null;
          setStatus('Done. Files fetched: ' + payload.total);
          hideBar();
        } else {
          updateMultiTaskStatus();
        }
        break;

      case 'page-counts':
        chrome.runtime.sendMessage({ action: 'store-page-counts', collectionId: cid, payload: payload }).catch(function(err){
          console.error('[AxonExt-Bridge] store-page-counts error:', err);
        });
        break;
      case 'pagecount-fetch-started':
        scanning = true; currentPhase = 'pages';
        activeTasks.pages = (payload.fetched || 0) + '/' + payload.total;
        updateMultiTaskStatus();
        showBar(); showPauseBtn();
        break;
      case 'pagecount-fetch-progress':
        activeTasks.pages = payload.fetched + '/' + payload.total;
        updateMultiTaskStatus();
        setProgress(payload.fetched / payload.total);
        break;
      case 'pagecount-fetch-complete':
        activeTasks.pages = null;
        hidePageCountBtn();
        chrome.runtime.sendMessage({ action: 'pages-fetch-done', collectionId: cid }).catch(function(){});
        if (!activeTasks.files && !activeTasks.thumbs) {
          scanning = false; currentPhase = null;
          setStatus('Done. Page counts: ' + (payload.withCounts || 0) + ' PDFs');
          hideBar();
        } else {
          updateMultiTaskStatus();
        }
        break;

      case 'thumbnails':
        chrome.runtime.sendMessage({ action: 'store-thumbnails', collectionId: cid, payload: payload }).catch(function(err){
          console.error('[AxonExt-Bridge] store-thumbnails error:', err);
        });
        break;
      case 'thumbnail-fetch-started':
        scanning = true; currentPhase = 'thumbs';
        activeTasks.thumbs = (payload.fetched || 0) + '/' + payload.total;
        updateMultiTaskStatus();
        showBar(); showPauseBtn();
        break;
      case 'thumbnail-fetch-progress':
        activeTasks.thumbs = payload.fetched + '/' + payload.total;
        updateMultiTaskStatus();
        setProgress(payload.fetched / payload.total);
        break;
      case 'thumbnail-fetch-complete':
        activeTasks.thumbs = null;
        hideThumbnailCacheBtn();
        chrome.runtime.sendMessage({ action: 'thumbs-fetch-done', collectionId: cid }).catch(function(){});
        if (!activeTasks.files && !activeTasks.pages) {
          scanning = false; currentPhase = null;
          setStatus('Done. Thumbnails cached: ' + (payload.withThumbs || 0));
          hideBar();
        } else {
          updateMultiTaskStatus();
        }
        break;

      case 'api-seen':
        var actBtn = document.getElementById('__axon_action_btn');
        var viewBtn = document.getElementById('__axon_open_btn');
        if ((!actBtn || actBtn.style.display === 'none') && (!viewBtn || viewBtn.style.display === 'none')) {
          setStatus('Detected evidence API (' + (payload && payload.reason ? payload.reason : 'unknown') + ') — waiting for the full list…');
        }
        break;
      case 'auth-error':
        scanning = false; currentPhase = null;
        setStatus('Auth error (' + (payload.error || '') + ') at index ' + payload.index + '. Click to resume.');
        hideBar();
        if (payload.fetched !== undefined) {
          detailLastIndex = payload.index;
          detailLastTotal = payload.total;
        }
        break;

      case 'detail-paused':
        setStatus('Paused at index ' + payload.index + '. Click Resume.');
        hideBar();
        if (payload.fetched !== undefined) {
          detailLastIndex = payload.index;
          detailLastTotal = payload.total;
        }
        break;
    }
  }

  function setStatus(text) {
    var el = document.getElementById('__axon_status_text');
    if (el) el.textContent = text;
  }
  function setProgress(frac) {
    var bar = document.getElementById('__axon_progress_fill');
    if (bar) bar.style.width = Math.round(frac * 100) + '%';
  }
  function showBar() {
    var bar = document.getElementById('__axon_progress_bar');
    if (bar) bar.style.display = 'block';
  }
  function hideBar() {
    var bar = document.getElementById('__axon_progress_bar');
    if (bar) bar.style.display = 'none';
  }

  function showScrapeBtn() {
    var btn = document.getElementById('__axon_action_btn');
    if (btn) { btn.textContent = 'Scrape'; btn.style.display = 'block'; pauseBtnPaused = false; }
  }
  function showReScrapeBtn() {
    var btn = document.getElementById('__axon_action_btn');
    if (btn) { btn.textContent = 'Re-scrape'; btn.style.display = 'block'; pauseBtnPaused = false; }
  }
  function showPauseBtn() {
    var btn = document.getElementById('__axon_action_btn');
    if (btn) { btn.textContent = 'Pause'; pauseBtnPaused = false; }
  }
  function showFetchFilesBtn() {
    var btn = document.getElementById('__axon_files_btn');
    if (btn) btn.style.display = 'block';
  }
  function hideFetchFilesBtn() {
    var btn = document.getElementById('__axon_files_btn');
    if (btn) btn.style.display = 'none';
  }
  function showViewBtn() {
    var btn = document.getElementById('__axon_open_btn');
    if (btn) { btn.textContent = 'View'; btn.style.display = 'block'; }
  }
  function showPageCountBtn() {
    var btn = document.getElementById('__axon_pages_btn');
    if (btn) btn.style.display = 'block';
  }
  function hidePageCountBtn() {
    var btn = document.getElementById('__axon_pages_btn');
    if (btn) btn.style.display = 'none';
  }
  function showThumbnailCacheBtn() {
    var btn = document.getElementById('__axon_thumbs_btn');
    if (btn) btn.style.display = 'block';
  }
  function hideThumbnailCacheBtn() {
    var btn = document.getElementById('__axon_thumbs_btn');
    if (btn) btn.style.display = 'none';
  }

  var isMinimized = false;

  async function renderLogPanel() {
    var entriesEl = document.getElementById('__axon_log_entries');
    if (!entriesEl) return;
    try {
      var resp = await chrome.runtime.sendMessage({ action: 'get-logs' });
      var logs = (resp && resp.logs) ? resp.logs : [];
      if (logs.length === 0) {
        entriesEl.innerHTML = '<span style="color:#64748b;">No logs recorded yet.</span>';
        return;
      }
      var recent = logs.slice(-25).reverse();
      entriesEl.innerHTML = recent.map(function(l) {
        var timeStr = l.time ? l.time.split('T')[1].split('.')[0] : '';
        var color = l.level === 'error' ? '#ef4444' : l.level === 'warn' ? '#fbbf24' : '#38bdf8';
        return '<div style="margin-bottom:3px;word-break:break-all;">' +
          '<span style="color:#64748b;">' + timeStr + '</span> ' +
          '<strong style="color:' + color + ';">[' + l.context + ']</strong> ' +
          escapeHtml(l.message) +
          (l.details ? ' <span style="color:#64748b;">(' + escapeHtml(l.details.slice(0, 80)) + ')</span>' : '') +
          '</div>';
      }).join('');
    } catch (e) {
      entriesEl.innerHTML = '<span style="color:#ef4444;">Error reading logs: ' + escapeHtml(e.message) + '</span>';
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
  }

  function createOverlay() {
    if (document.getElementById('__axon_overlay_container')) return;

    var container = document.createElement('div');
    container.id = '__axon_overlay_container';
    container.innerHTML = [
      '<div id="__axon_overlay" style="',
      'position:fixed;right:24px;bottom:24px;z-index:2147483646;',
      'background:#1e293b;color:#e2e8f0;border-radius:12px;',
      'box-shadow:0 8px 32px rgba(0,0,0,0.35);',
      'font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;',
      'font-size:13px;line-height:1.5;min-width:240px;max-width:340px;',
      'border:1px solid #334155;',
      '">',
      '<div id="__axon_overlay_header" style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:move;user-select:none;border-radius:12px 12px 0 0;">',
      '<span style="font-size:16px;">\u2699</span>',
      '<strong style="flex:1;">Evidence Aggregator</strong>',
      '<span style="color:#64748b;font-size:11px;" id="__axon_status_text">Waiting for data\u2026</span>',
      '<button id="__axon_log_btn" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:13px;padding:0 3px;" title="View diagnostics & logs">\uD83D\uDCCB</button>',
      '<button id="__axon_min_btn" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;padding:0 2px;line-height:1;" title="Minimize">\u2212</button>',
      '</div>',
      '<div id="__axon_overlay_body" style="padding:0 14px 10px;">',
      '<div id="__axon_progress_bar" style="display:none;height:4px;background:#334155;border-radius:2px;margin-bottom:8px;overflow:hidden;">',
      '<div id="__axon_progress_fill" style="height:100%;width:0%;background:#38bdf8;border-radius:2px;transition:width 0.3s;"></div>',
      '</div>',
      '<div style="display:flex;gap:8px;">',
      '<button id="__axon_action_btn" style="flex:1;padding:6px 10px;background:#334155;color:#e2e8f0;border:none;border-radius:6px;cursor:pointer;font-size:12px;display:none;">Scrape</button>',
      '<button id="__axon_files_btn" style="flex:1;padding:6px 10px;background:#78350f;color:#fbbf24;border:none;border-radius:6px;cursor:pointer;font-size:12px;display:none;">Fetch Files</button>',
      '<button id="__axon_pages_btn" style="flex:1;padding:6px 10px;background:#14532d;color:#86efac;border:none;border-radius:6px;cursor:pointer;font-size:12px;display:none;">PDF Pages</button>',
      '<button id="__axon_thumbs_btn" style="flex:1;padding:6px 10px;background:#1e3a5f;color:#93c5fd;border:none;border-radius:6px;cursor:pointer;font-size:12px;display:none;">Cache Thumbs</button>',
      '<button id="__axon_open_btn" style="flex:1;padding:6px 10px;background:#38bdf8;color:#0f172a;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;display:none;">View</button>',
      '</div>',
      '<div id="__axon_log_panel" style="display:none;margin-top:8px;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px;max-height:140px;overflow-y:auto;font-family:monospace;font-size:10px;color:#94a3b8;line-height:1.4;">',
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;border-bottom:1px solid #1e293b;padding-bottom:2px;">',
      '<strong style="color:#38bdf8;">Recent Logs</strong>',
      '<button id="__axon_copy_logs_btn" style="background:#334155;color:#e2e8f0;border:none;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:10px;">Copy</button>',
      '</div>',
      '<div id="__axon_log_entries">Loading logs\u2026</div>',
      '</div>',
      '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(container);

    var overlay = document.getElementById('__axon_overlay');
    var header = document.getElementById('__axon_overlay_header');
    var body = document.getElementById('__axon_overlay_body');
    var logPanel = document.getElementById('__axon_log_panel');

    var dragging = false, dragX = 0, dragY = 0;
    header.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      var rect = overlay.getBoundingClientRect();
      dragX = e.clientX - rect.left;
      dragY = e.clientY - rect.top;
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', onDragEnd);
    });
    function onDrag(e) {
      if (!dragging) return;
      overlay.style.left = (e.clientX - dragX) + 'px';
      overlay.style.top = (e.clientY - dragY) + 'px';
    }
    function onDragEnd() {
      dragging = false;
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', onDragEnd);
    }

    document.getElementById('__axon_min_btn').addEventListener('click', function() {
      isMinimized = !isMinimized;
      body.style.display = isMinimized ? 'none' : '';
      this.textContent = isMinimized ? '+' : '\u2212';
      if (isMinimized) overlay.style.borderRadius = '12px';
    });

    document.getElementById('__axon_log_btn').addEventListener('click', function() {
      if (logPanel.style.display === 'none') {
        logPanel.style.display = 'block';
        renderLogPanel();
      } else {
        logPanel.style.display = 'none';
      }
    });

    document.getElementById('__axon_copy_logs_btn').addEventListener('click', async function() {
      try {
        var resp = await chrome.runtime.sendMessage({ action: 'get-logs' });
        var logs = (resp && resp.logs) ? resp.logs : [];
        var text = logs.map(function(l) { return '[' + l.time + '] [' + l.level.toUpperCase() + '] [' + l.context + '] ' + l.message + (l.details ? ' ' + l.details : ''); }).join('\n');
        await navigator.clipboard.writeText(text);
        this.textContent = 'Copied!';
        var btn = this;
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      } catch (e) {
        alert('Could not copy logs: ' + e.message);
      }
    });

    document.getElementById('__axon_action_btn').addEventListener('click', function() {
      if (ready && !scanning) {
        if (existingCollection && existingCollection.collectionId) {
          chrome.runtime.sendMessage({ action: 'delete-collection', collectionId: existingCollection.collectionId }).then(function() {
            window.location.reload();
          }).catch(function() {
            window.location.reload();
          });
        } else {
          window.location.reload();
        }
        return;
      }
      if (!scanning) {
        pauseBtnPaused = false; this.textContent = 'Pause';
        window.postMessage({ source: 'axon-extension', action: 'start-pagination' }, '*');
      } else if (!pauseBtnPaused) {
        pauseBtnPaused = true; this.textContent = 'Resume';
        if (currentPhase === 'pagination') {
          window.postMessage({ source: 'axon-extension', action: 'pause-pagination' }, '*');
        } else {
          window.postMessage({ source: 'axon-extension', action: 'pause-detail' }, '*');
        }
      } else {
        pauseBtnPaused = false; this.textContent = 'Pause';
        if (currentPhase === 'pagination') {
          window.postMessage({ source: 'axon-extension', action: 'resume-pagination' }, '*');
        } else {
          window.postMessage({ source: 'axon-extension', action: 'resume-detail', detailType: currentPhase || getLastDetailPhase(), resumeIndex: detailLastIndex }, '*');
        }
      }
    });

    document.getElementById('__axon_open_btn').addEventListener('click', function() {
      var cid = getEffectiveCollectionId();
      if (!cid) {
        var m = window.location.href.match(/\/case\/([a-fA-F0-9-]+)/);
        if (m) cid = m[1];
      }
      chrome.runtime.sendMessage({ action: 'open-viewer', collectionId: cid }).catch(function(err){
        console.error('[AxonExt-Bridge] open-viewer error:', err);
      });
    });

    document.getElementById('__axon_files_btn').addEventListener('click', function() {
      hideFetchFilesBtn();
      var resumeIdx = (currentPhase === 'files') ? detailLastIndex : 0;
      window.postMessage({ source: 'axon-extension', action: 'start-files-fetch', resumeIndex: resumeIdx }, '*');
    });

    document.getElementById('__axon_pages_btn').addEventListener('click', function() {
      hidePageCountBtn();
      var resumeIdx = (currentPhase === 'pages') ? detailLastIndex : 0;
      window.postMessage({ source: 'axon-extension', action: 'start-pagecount-fetch', resumeIndex: resumeIdx }, '*');
    });

    document.getElementById('__axon_thumbs_btn').addEventListener('click', function() {
      hideThumbnailCacheBtn();
      var resumeIdx = (currentPhase === 'thumbs') ? detailLastIndex : 0;
      window.postMessage({ source: 'axon-extension', action: 'start-thumbnail-fetch', resumeIndex: resumeIdx }, '*');
    });
  }

  function getLastDetailPhase() {
    if (document.getElementById('__axon_files_btn').style.display !== 'none') return 'files';
    if (document.getElementById('__axon_pages_btn').style.display !== 'none') return 'pages';
    if (document.getElementById('__axon_thumbs_btn').style.display !== 'none') return 'thumbs';
    return 'files';
  }

  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.action === 'pause-pagination')
      window.postMessage({ source: 'axon-extension', action: 'pause-pagination' }, '*');
    if (msg.action === 'resume-pagination')
      window.postMessage({ source: 'axon-extension', action: 'resume-pagination' }, '*');
    if (msg.action === 'cancel-pagination')
      window.postMessage({ source: 'axon-extension', action: 'cancel-pagination' }, '*');
  });

  async function checkExistingCase() {
    try {
      if (!caseLabel) caseLabel = extractCaseLabel();
      var resp = await chrome.runtime.sendMessage({ action: 'check-case', url: window.location.href });
      if (resp && resp.found && resp.collection) {
        var col = resp.collection;
        var sl = col.scrapeLevels || { initial: false, files: false, pages: false, thumbs: false };
        if (!caseLabel && col.caseLabel) caseLabel = col.caseLabel;
        var prefix = caseLabel ? caseLabel + ': ' : '';
        if (col.status === 'complete') {
          currentCollectionId = col.id;
          existingCollection = { collectionId: col.id, count: col.count };
          scanning = false; ready = true;
          setStatus(prefix + 'Already scraped: ' + col.count + ' records  ' + buildLevelStatus(sl));
          showViewBtn();
          showReScrapeBtn();
          showButtonsForLevels(sl);
          loadStateForIntercept(col.id);
          console.log('[AxonExt-Bridge] Recognized existing collection:', col.id, col.count, 'records, levels:', JSON.stringify(sl));
        } else if (col.status === 'paused') {
          currentCollectionId = col.id;
          existingCollection = { collectionId: col.id, count: col.count };
          setStatus(prefix + 'Previously paused: ' + (col.count || 0) + '/' + col.totalCount + ' records');
          showReScrapeBtn();
        }
      }
    } catch(e) {
      console.warn('[AxonExt-Bridge] checkExistingCase failed:', e);
    }
  }

  function initOverlay() {
    if (document.body) { createOverlay(); checkExistingCase(); requestInterceptStatus(); }
    else { document.addEventListener('DOMContentLoaded', function() { createOverlay(); checkExistingCase(); requestInterceptStatus(); }); }
  }

  function requestInterceptStatus() {
    try { window.postMessage({ source: 'axon-extension', action: 'get-status' }, '*'); } catch (e) {}
  }

  async function loadStateForIntercept(collectionId) {
    try {
      var evResp = await chrome.runtime.sendMessage({ action: 'get-evidence', collectionId: collectionId });
      var fileResp = await chrome.runtime.sendMessage({ action: 'get-files', collectionId: collectionId });
      window.postMessage({
        source: 'axon-extension',
        action: 'set-state',
        evidenceItems: (evResp && evResp.evidence) ? evResp.evidence : [],
        fileMap: (fileResp && fileResp.files) ? fileResp.files : []
      }, '*');
      console.log('[AxonExt-Bridge] Loaded state for collection', collectionId,
        ':', (evResp && evResp.evidence ? evResp.evidence.length : 0), 'items,',
        (fileResp && fileResp.files ? fileResp.files.length : 0), 'files');
    } catch(e) {
      console.error('[AxonExt-Bridge] loadStateForIntercept failed:', e);
    }
  }

  initOverlay();
})();
