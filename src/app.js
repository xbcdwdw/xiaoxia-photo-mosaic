// ===== 常量 =====
console.log('app.js loaded')

// 全局错误捕获
window.onerror = (msg, url, line) => console.error('GLOBAL ERROR:', msg, 'at line', line)

const PAPER_W_MM = 148
const PAPER_H_MM = 100
const PREVIEW_DPI = 600
const EXPORT_DPI = 600
const CANVAS_W = Math.round(PAPER_W_MM / 25.4 * PREVIEW_DPI)
const CANVAS_H = Math.round(PAPER_H_MM / 25.4 * PREVIEW_DPI)
const CANVAS_W_HIRES = Math.round(PAPER_W_MM / 25.4 * EXPORT_DPI)
const CANVAS_H_HIRES = Math.round(PAPER_H_MM / 25.4 * EXPORT_DPI)

const STANDARD_SIZES = [
  { name: '小1寸', w: 22, h: 32 }, { name: '1寸', w: 25, h: 35 },
  { name: '大1寸', w: 33, h: 48 }, { name: '小2寸', w: 35, h: 45 },
  { name: '2寸', w: 35, h: 53 }, { name: '5寸(3R)', w: 89, h: 127 },
  { name: '6寸(4R)', w: 102, h: 152 },
]

// ===== 状态 =====
const state = {
  photos: [],
  layout: 2,
  borderType: 'zero',
  cornerType: 'none',
  antiSharpen: 0,
  showCutLine: true,
  standardMode: false,
  standardIdx: 1,
  standardLayout: null,
  currentPhotos: [],
  generated: [],
  highRes: false,
  debugMode: false,
  currentPage: 0,
  totalPages: 0,
  lastExportDPI: 600,
  isMobile: window.innerWidth < 700 || ('ontouchstart' in window),
  darkMode: false,
  // 排序模式：'time' = 按拍摄时间; 'order' = 按选择顺序（添加顺序）
  sortMode: 'time',
  // 'asc' = 早→晚（默认）; 'desc' = 晚→早
  sortDir: 'asc',
  // 点击交换顺序：true = 开启（轻点选中照片 → 再轻点另一张交换，只识别点击，不识别滑动/长按）
  swapByTap: true,
  // 当前点击选中的照片 id
  swapSelectedId: null,
}

// ===== DOM =====
const $ = id => document.getElementById(id)

// ===== 工具 =====
function getBorderMM(t) { return { zero: 0, small: 1, large: 2, xlarge: 4 }[t] || 0 }

function genSaveName(i) {
  const now = new Date()
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`
  return `拼图_${ts}_${i+1}.png`
}
function getLayoutProps(t) {
  const s = getBorderMM(t)
  return { gap: s * 2, margin: s + 3.5, top: s + 2 }
}

function toast(msg) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2500)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// ===== 照片管理 =====
let photoIdCounter = 0

// ----- 读取拍摄时间（EXIF DateTimeOriginal，失败时回退文件修改时间） -----
function parseExifDateTimeString(s) {
  // EXIF 时间格式: "2024:01:15 09:30:45"
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '')
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return isNaN(d.getTime()) ? null : d
}

function parseJpegExif(buf) {
  // 简化但完整的 JPEG EXIF 解析：定位 APP1 段中的 Exif TIFF，
  // 依次读取 IFD0 -> ExifIFD(0x8769)，取 DateTimeOriginal(0x9003)/DateTimeDigitized(0x9004)/DateTime(0x0132)
  try {
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null
    let off = 2
    while (off + 4 <= buf.length) {
      if (buf[off] !== 0xFF) break
      const marker = buf[off + 1]
      if (marker === 0xD8 || marker === 0x01) { off += 2; continue } // SOI / TEM
      if (marker >= 0xD0 && marker <= 0xD7) { off += 2; continue }   // RSTn
      if (marker === 0xD9) break                                    // EOI
      const len = (buf[off + 2] << 8) | buf[off + 3]
      if (marker === 0xE1) { // APP1
        const segStart = off + 4
        // 检查 "Exif\0\0"
        if (segStart + 6 <= buf.length &&
            buf[segStart] === 0x45 && buf[segStart + 1] === 0x78 &&
            buf[segStart + 2] === 0x69 && buf[segStart + 3] === 0x66 &&
            buf[segStart + 4] === 0x00 && buf[segStart + 5] === 0x00) {
          return parseTiffExif(buf.subarray(segStart + 6))
        }
        return null // 已到 APP1 但不是 Exif
      }
      if (len < 2) break
      off += 2 + len
    }
  } catch (e) { /* 解析失败返回 null */ }
  return null
}

function parseTiffExif(view) {
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength)
  if (view.length < 8) return null
  const little = view[0] === 0x49 // 'II' 小端
  const u16 = little ? (o) => dv.getUint16(o, true) : (o) => dv.getUint16(o, false)
  const u32 = little ? (o) => dv.getUint32(o, true) : (o) => dv.getUint32(o, false)
  if (u16(2) !== 0x002A) return null
  const ifd0 = u32(4)
  if (ifd0 + 2 > view.length) return null
  const count = u16(ifd0)
  let exifPtr = -1
  for (let i = 0; i < count; i++) {
    const ent = ifd0 + 2 + i * 12
    if (ent + 12 > view.length) break
    const tag = u16(ent)
    if (tag === 0x8769) { exifPtr = u32(ent + 8); break } // ExifIFDPointer
  }
  if (exifPtr < 0 || exifPtr + 2 > view.length) return null
  const exifCount = u16(exifPtr)
  const find = (t) => {
    for (let i = 0; i < exifCount; i++) {
      const ent = exifPtr + 2 + i * 12
      if (ent + 12 > view.length) break
      if (u16(ent) === t) {
        const type = u16(ent + 2), n = u32(ent + 4)
        const off = n === 1 && type <= 7 ? ent + 8 : u32(ent + 8)
        // ASCII 字符串（type=2）
        if (type === 2 && off + 20 <= view.length) {
          const bytes = []
          for (let k = 0; k < 19; k++) {
            const b = view[off + k]
            if (b === 0) break
            bytes.push(String.fromCharCode(b))
          }
          return bytes.join('')
        }
        return null
      }
    }
    return null
  }
  return parseExifDateTimeString(
    find(0x9003) || find(0x9004) || find(0x0132)
  )
}

function readPhotoTime(file) {
  return new Promise((resolve) => {
    const fallback = new Date(file.lastModified || Date.now())
    // 仅 JPEG 含标准 EXIF；其余格式直接用文件时间
    if (!file || file.type !== 'image/jpeg') { resolve(fallback); return }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const arr = new Uint8Array(reader.result)
        const t = parseJpegExif(arr)
        resolve(t || fallback)
      } catch (e) { resolve(fallback) }
    }
    reader.onerror = () => resolve(fallback)
    reader.readAsArrayBuffer(file)
  })
}

async function addPhotos(files) {
  const batch = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const id = ++photoIdCounter
    const url = URL.createObjectURL(file)
    batch.push({ id, url, file, rotation: 0, offX: 0, offY: 0, offXRatio: 0, offYRatio: 0, takenAt: undefined })
  }
  if (!batch.length) return
  // 记录原始序号，保证时间相同时排序稳定、且可恢复"选择顺序"
  batch.forEach((p, i) => { p._origIdx = state.photos.length + i })
  state.photos = state.photos.concat(batch)
  if (state.sortMode === 'time') {
    await sortPhotosByTime()
  } else {
    renderPhotoList()
    rebuild()
  }
}

// 按拍摄时间重新排列（升序/降序），时间缺失的按文件修改时间，仍缺失的保持原顺序
async function sortPhotosByTime() {
  if (state.photos.length < 2) { renderPhotoList(); return }
  for (const p of state.photos) {
    if (p.takenAt === undefined && p.file) p.takenAt = await readPhotoTime(p.file)
  }
  const dir = state.sortDir === 'desc' ? -1 : 1
  const withIdx = state.photos.map((p, i) => ({ p, i }))
  withIdx.sort((a, b) => {
    const ta = (a.p.takenAt && a.p.takenAt.getTime()) || (a.p.file ? a.p.file.lastModified : 0)
    const tb = (b.p.takenAt && b.p.takenAt.getTime()) || (b.p.file ? b.p.file.lastModified : 0)
    const diff = (ta - tb) * dir
    if (diff !== 0) return diff
    return (a.p._origIdx ?? a.i) - (b.p._origIdx ?? b.i)
  })
  state.photos = withIdx.map(x => x.p)
  renderPhotoList()
  rebuild()
}

// 按选择顺序（添加顺序）恢复排列
function sortBySelectOrder() {
  if (state.photos.length < 2) { renderPhotoList(); return }
  const withIdx = state.photos.map((p, i) => ({ p, i }))
  withIdx.sort((a, b) => (a.p._origIdx ?? a.i) - (b.p._origIdx ?? b.i))
  state.photos = withIdx.map(x => x.p)
  renderPhotoList()
  rebuild()
}

function syncSortUIControls() {
  const t = $('sortToggle'), d = $('sortDirBtn')
  if (t) {
    t.classList.toggle('active', state.sortMode === 'time')
    t.textContent = state.sortMode === 'time' ? '📅 时间排序' : '📋 选择顺序'
  }
  if (d) {
    d.style.display = state.sortMode === 'time' ? '' : 'none'
    d.textContent = state.sortDir === 'desc' ? '↓ 新→旧' : '↑ 早→晚'
  }
}

function removePhoto(id) {
  const idx = state.photos.findIndex(p => p.id === id)
  if (idx < 0) return
  URL.revokeObjectURL(state.photos[idx].url)
  state.photos.splice(idx, 1)
  renderPhotoList()
  rebuild()
}

function clearAllPhotos() {
  if (!state.photos.length) return
  if (!confirm('确定删除所有照片？')) return
  state.photos.forEach(p => URL.revokeObjectURL(p.url))
  state.photos = []
  state.currentPhotos = []
  state.swapSelectedId = null
  renderPhotoList()
  rebuild()
  $('resultSection').style.display = 'none'
}

// ===== 渲染照片列表 =====
let _touchDrag = null // { el, idx, startY, startX, dragging }

function renderPhotoList() {
  const list = $('photoList')
  $('photoCount').textContent = state.photos.length
  const clearBtn = $('clearBtn')
  if (clearBtn) clearBtn.style.display = state.photos.length ? 'inline' : 'none'
  if (!state.photos.length) {
    list.innerHTML = '<div class="empty-hint">拖拽图片到此处<br>或点击下方按钮添加</div>'
    return
  }
  list.innerHTML = ''
  state.photos.forEach((p, i) => {
    const div = document.createElement('div')
    div.className = 'photo-item'
    div.draggable = !state.isMobile
    div.dataset.id = p.id
    if (p.id === state.swapSelectedId) {
      div.style.outline = '3px solid #07c160'
      div.style.outlineOffset = '-3px'
    }
    div.innerHTML = `
      <img src="${p.url}">
      <span class="idx-label">${i + 1}</span>
      <span class="remove-overlay" data-id="${p.id}">×</span>`
    // 桌面端拖拽删除
    if (!state.isMobile) {
      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(p.id))
        div.classList.add('dragging-source')
        $('trashZone').classList.add('active')
      })
      div.addEventListener('dragend', () => {
        div.classList.remove('dragging-source')
        $('trashZone').classList.remove('active')
      })
    }
    // 点击×删除
    div.querySelector('.remove-overlay').onclick = (e) => {
      e.stopPropagation()
      removePhoto(p.id)
    }
    list.appendChild(div)
  })
  // 桌面端拖拽重排
  if (!state.isMobile) {
    setupPhotoReorder(list)
  }
  // 手机端长按拖动排序
  if (state.isMobile) {
    setupTouchReorder(list)
  }
}

function movePhoto(from, to) {
  if (from === to || to < 0 || to >= state.photos.length) return
  const item = state.photos.splice(from, 1)[0]
  state.photos.splice(to, 0, item)
  renderPhotoList()
  // 拖拽中不 rebuild，只重置 currentPhotos 保持页面
  state.currentPage = 0
  goToPage(0)
}

// 手机端"点击交换顺序"：只识别点击（轻点选中 → 再轻点另一张交换）
// 完全不识别长按和滑动：横滑浏览、长按均不会触发交换
function setupTouchReorder(list) {
  // 防重复绑定：renderPhotoList 每次渲染都会调用本函数
  if (list.dataset.touchReorderBound) return
  list.dataset.touchReorderBound = '1'

  let pressStartX = 0, pressStartY = 0
  const TAP_THRESHOLD = 10 // px：位移小于此值才算"点击"

  function clearSelection() {
    if (state.swapSelectedId === null) return
    state.swapSelectedId = null
    renderPhotoList()
  }

  list.addEventListener('touchstart', (e) => {
    if (!state.swapByTap) return
    const t = e.touches[0]
    if (!t) return
    pressStartX = t.clientX
    pressStartY = t.clientY
  }, { passive: true })

  list.addEventListener('touchend', (e) => {
    if (!state.swapByTap) return
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    // 位移超过阈值 → 是滑动，不响应
    if (Math.abs(t.clientX - pressStartX) > TAP_THRESHOLD || Math.abs(t.clientY - pressStartY) > TAP_THRESHOLD) return
    // 点击空白或删除按钮 → 取消选中
    const item = e.target.closest('.photo-item')
    if (!item || e.target.closest('.remove-overlay')) { clearSelection(); return }
    const idx = Array.from(list.children).indexOf(item)
    const p = state.photos[idx]
    if (!p) return
    if (state.swapSelectedId === null) {
      // 第一次点击：选中该照片
      state.swapSelectedId = p.id
      renderPhotoList()
      toast('已选中第 ' + (idx + 1) + ' 张，点击另一张交换位置')
    } else if (state.swapSelectedId === p.id) {
      // 点击同一张：取消选中
      clearSelection()
    } else {
      // 点击另一张：交换顺序
      const fromIdx = state.photos.findIndex(x => x.id === state.swapSelectedId)
      state.swapSelectedId = null
      if (fromIdx >= 0) movePhoto(fromIdx, idx)
    }
  }, { passive: true })
}

// ===== 拖拽添加入口 =====
function setupDragDrop() {
  // document 级拦截（冒泡最高层）
  document.addEventListener('dragenter', (e) => { e.preventDefault() })
  document.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  })
  document.addEventListener('dragleave', () => { document.body.classList.remove('drag-over') })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    document.body.classList.remove('drag-over')
    $('trashZone').classList.remove('active')
    // 删除区拖拽
    if (e.target.closest && e.target.closest('#trashZone')) {
      const id = parseInt(e.dataTransfer.getData('text/plain'))
      if (id) removePhoto(id)
      return
    }
    // 添加文件
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      addPhotos(Array.from(e.dataTransfer.files))
    }
  })

  // body 级：视觉反馈
  document.body.addEventListener('dragenter', () => { document.body.classList.add('drag-over') })
  document.body.addEventListener('dragleave', (e) => {
    if (!document.body.contains(e.relatedTarget)) document.body.classList.remove('drag-over')
  })

  // 文件选择
  $('fileInput').onchange = (e) => {
    if (e.target.files.length) addPhotos(Array.from(e.target.files))
    e.target.value = ''
  }
  $('addBtn').onclick = pickFromGallery
  // 手机端内联添加按钮
  const inlineBtn = $('addBtnInline')
  if (inlineBtn) {
    inlineBtn.onclick = pickFromGallery
    inlineBtn.style.display = state.isMobile ? 'inline-flex' : 'none'
  }
}

// ===== 选择照片入口 =====
async function pickFromGallery() {
  // 直接显示文件选择器（手机和桌面都可用）
  $('fileInput').click()
}

// ===== 拖拽删除区 =====
function setupTrashZone() {
  const zone = $('trashZone')
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-hover') })
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-hover'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('active', 'drag-hover')
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id) removePhoto(id)
  })
}

// ===== 翻页 =====
function getPerPage() {
  return state.standardMode ? (state.standardLayout?.total || 4) : state.layout
}

function getTotalPages() {
  const perPage = getPerPage()
  return Math.max(1, Math.floor(state.photos.length / perPage))
}

function goToPage(page) {
  const perPage = getPerPage()
  state.totalPages = getTotalPages()
  state.currentPage = Math.max(0, Math.min(page, state.totalPages - 1))
  const start = state.currentPage * perPage
  const end = Math.min(start + perPage, state.photos.length)
  state.currentPhotos = state.photos.slice(start, end)
  rebuildPreviewOnly()
}

function rebuildPreviewOnly() {
  loadCurrentImages().then(() => {
    renderPreview()
    updatePageNav()
    updateControls()
  })
}

// ===== 重建拼图 =====
async function rebuild() {
  state.currentPage = 0
  goToPage(0)
}

async function rebuildStandard() {
  const layout = state.standardLayout
  if (!layout || !state.photos.length) return
  state.currentPage = 0
  goToPage(0)
}

function updatePageNav() {
  const nav = $('pageNav')
  if (state.totalPages <= 1 || !state.photos.length) {
    nav.style.display = 'none'
    return
  }
  nav.style.display = 'flex'
  $('pageIndicator').textContent = `${state.currentPage + 1}/${state.totalPages}`
  $('prevPageBtn').disabled = state.currentPage === 0
  $('nextPageBtn').disabled = state.currentPage >= state.totalPages - 1
}

async function loadCurrentImages() {
  for (const p of state.currentPhotos) {
    if (p.file && !p._img) {
      try { p._img = await loadImage(p.url) } catch { p._img = null }
    }
  }
}

function initCanvas() {
  const canvas = $('previewCanvas')
  const wrap = canvas.parentElement
  const rect = wrap.getBoundingClientRect()
  const availW = Math.max(rect.width, 100)
  const availH = Math.max(rect.height, 100)
  const aspect = CANVAS_W / CANVAS_H
  let w, h
  if (availW / availH > aspect) { h = availH; w = Math.round(h * aspect) }
  else { w = availW; h = Math.round(w / aspect) }
  previewW = w; previewH = h
  const dpr = window.devicePixelRatio || 1
  canvas.width = previewW * dpr; canvas.height = previewH * dpr
  canvas.style.width = previewW + 'px'; canvas.style.height = previewH + 'px'
  previewCtx = canvas.getContext('2d'); previewCtx.scale(dpr, dpr)
}

// ===== Canvas 预览（自适应容器） =====


// ===== 预览 Canvas =====

function renderPreview() {
  if (!previewCtx) initCanvas()
  const ctx = previewCtx; const dpr = window.devicePixelRatio || 1
  const canvas = $('previewCanvas')
  canvas.width = previewW * dpr; canvas.height = previewH * dpr
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, previewW, previewH)
  const n = state.standardMode ? (state.standardLayout?.total || 4) : state.layout
  const cols = n === 3 || n === 6 ? 3 : 2
  const rows = n === 4 || n === 6 ? 2 : 1
  const cellW = previewW / cols, cellH = previewH / rows
  // 间距
  const border = getBorderMM(state.borderType)
  const gapPx = border * (cellW * 0.04) // 间距 = 边框mm数 × 单元格宽的4%
  const inset = gapPx / 2
  let idx = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (idx < state.currentPhotos.length) {
        const cx = c * cellW + inset, cy = r * cellH + inset
        drawCell(ctx, state.currentPhotos[idx], cx, cy, cellW - gapPx, cellH - gapPx)
      }
      idx++
    }
  }
  // 裁切线（仅 >2 张时绘制）
  if (state.showCutLine && n > 2) {
    ctx.save(); ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5])
    ctx.beginPath()
    if (n === 3) { for (let c = 1; c < 3; c++) { const lx = c * cellW; ctx.moveTo(lx, 0); ctx.lineTo(lx, previewH) } }
    else if (n === 4) { ctx.moveTo(cellW, 0); ctx.lineTo(cellW, previewH); ctx.moveTo(0, cellH); ctx.lineTo(previewW, cellH) }
    else { for (let c = 1; c < 3; c++) { ctx.moveTo(c * cellW, 0); ctx.lineTo(c * cellW, previewH) }; ctx.moveTo(0, cellH); ctx.lineTo(previewW, cellH) }
    ctx.stroke(); ctx.restore()
  }
  updateSlotControls()
}

function updateSlotControls() {
  const container = $('slotControls'); container.innerHTML = ''
  state.currentPhotos.forEach((p, i) => {
    const div = document.createElement('div'); div.className = 'slot-row'
    div.innerHTML = '<span>第' + (i + 1) + '张' + (p.rotation ? ' ' + p.rotation + '°' : '') + '</span>' +
      '<div class=\"slot-btns\">' +
      '<button class=\"adj-btn\" data-i=\"' + i + '\" data-dir=\"toggle\">↻ 旋转</button>' +
      '<button class=\"adj-btn reset\" data-i=\"' + i + '\" data-dir=\"reset\">居中</button></div>'
    container.appendChild(div)
  })
  container.querySelectorAll('.adj-btn').forEach(btn => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.i); const p = state.currentPhotos[i]; if (!p) return
      if (btn.dataset.dir === 'toggle') p.rotation = p.rotation === 90 ? 0 : 90
      else { p.offX = 0; p.offY = 0; p.offXRatio = 0; p.offYRatio = 0 }
      renderPreview(); updateSlotControls()
    }
  })
}

function drawCell(ctx, photo, x, y, w, h) {
  if (!photo || !photo._img) return
  // 圆角
  const rMap = { none: 0, small: w * 0.05, medium: w * 0.1, large: w * 0.15 }
  const r = rMap[state.cornerType] || 0
  ctx.save()
  if (r > 0) {
    ctx.beginPath()
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath(); ctx.clip()
  } else {
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  }
  const img = photo._img; const rot = photo.rotation || 0
  ctx.translate(x + w / 2, y + h / 2)
  ctx.rotate(rot * Math.PI / 180)
  const rw = (rot === 90) ? img.height : img.width
  const rh = (rot === 90) ? img.width : img.height
  const s = Math.max(w / rw, h / rh)
  const dw = img.width * s, dh = img.height * s
  const vw = (rot === 90) ? h : w, vh = (rot === 90) ? w : h
  const mX = Math.max(0, (dw - vw) / 2), mY = Math.max(0, (dh - vh) / 2)
  const offX = photo.offXRatio || 0, offY = photo.offYRatio || 0
  ctx.drawImage(img, -dw / 2 - offX * mX, -dh / 2 - offY * mY, dw, dh)
  ctx.restore()
  // 白边（模拟间距效果）
  if (state.borderType !== 'zero') {
    ctx.save()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
    if (r > 0) {
      ctx.beginPath()
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
    } else { ctx.beginPath(); ctx.rect(x, y, w, h) }
    ctx.stroke(); ctx.restore()
  }
}

// ===== Canvas 交互 =====
let dragging = false, dragIdx = -1, dragSX = 0, dragSY = 0

function setupCanvasInteractions() {
  const canvas = $('previewCanvas')
  if (!canvas) return
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width * previewW
    const y = (e.clientY - rect.top) / rect.height * previewH
    const cols = state.standardMode ? (state.standardLayout?.cols || 2) : (state.layout === 3 || state.layout === 6 ? 3 : 2)
    const rows = state.layout === 4 || state.layout === 6 ? 2 : 1
    const cw = previewW / cols, ch = previewH / rows
    const col = Math.floor(x / cw), row = Math.floor(y / ch)
    const idx = row * cols + col
    if (idx >= 0 && idx < state.currentPhotos.length) {
      dragging = true; dragIdx = idx; dragSX = e.clientX; dragSY = e.clientY
      if (e.button === 2) {
        state.currentPhotos[idx].rotation = state.currentPhotos[idx].rotation === 90 ? 0 : 90
        state.currentPhotos[idx].offXRatio = 0; state.currentPhotos[idx].offYRatio = 0
        renderPreview(); updateSlotControls(); return
      }
    }
  })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  document.addEventListener('mousemove', (e) => {
    if (!dragging || dragIdx < 0) return
    const photo = state.currentPhotos[dragIdx]; if (!photo || !photo._img) return
    const dx = (e.clientX - dragSX) / canvas.getBoundingClientRect().width * previewW
    const dy = (e.clientY - dragSY) / canvas.getBoundingClientRect().height * previewH
    const img = photo._img; const rot = photo.rotation || 0
    const rw = (rot === 90) ? img.height : img.width
    const rh = (rot === 90) ? img.width : img.height
    const cols = state.standardMode ? (state.standardLayout?.cols || 2) : (state.layout === 3 || state.layout === 6 ? 3 : 2)
    const rows = state.layout === 4 || state.layout === 6 ? 2 : 1
    const cw = previewW / cols, ch = previewH / rows
    const s = Math.max(cw / rw, ch / rh)
    const dw = img.width * s, dh = img.height * s
    const vw = (rot === 90) ? ch : cw, vh = (rot === 90) ? cw : ch
    const mX = Math.max(0, (dw - vw) / 2), mY = Math.max(0, (dh - vh) / 2)
    if (rot === 90) {
      if (mX > 0) photo.offXRatio = Math.max(-1, Math.min(1, -dy / mX))
      if (mY > 0) photo.offYRatio = Math.max(-1, Math.min(1, dx / mY))
    } else {
      if (mX > 0) photo.offXRatio = Math.max(-1, Math.min(1, -dx / mX))
      if (mY > 0) photo.offYRatio = Math.max(-1, Math.min(1, -dy / mY))
    }
    renderPreview()
  })
  document.addEventListener('mouseup', () => { if (dragging) { dragging = false; updateSlotControls() } })

  // 触屏单轴拖拽
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.touches[0].clientX - rect.left) / rect.width * previewW
    const y = (e.touches[0].clientY - rect.top) / rect.height * previewH
    const cols = state.standardMode ? (state.standardLayout?.cols || 2) : (state.layout === 3 || state.layout === 6 ? 3 : 2)
    const rows = state.layout === 4 || state.layout === 6 ? 2 : 1
    const cw = previewW / cols, ch = previewH / rows
    const col = Math.floor(x / cw), row = Math.floor(y / ch)
    const idx = row * cols + col
    if (idx >= 0 && idx < state.currentPhotos.length) {
      dragging = true; dragIdx = idx; dragSX = e.touches[0].clientX; dragSY = e.touches[0].clientY
    }
  }, { passive: true })
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault()
    if (!dragging || dragIdx < 0 || e.touches.length !== 1) return
    const photo = state.currentPhotos[dragIdx]; if (!photo || !photo._img) return
    const dx = (e.touches[0].clientX - dragSX) / canvas.getBoundingClientRect().width * previewW
    const dy = (e.touches[0].clientY - dragSY) / canvas.getBoundingClientRect().height * previewH
    const img = photo._img; const rot = photo.rotation || 0
    const rw = (rot === 90) ? img.height : img.width
    const rh = (rot === 90) ? img.width : img.height
    const cols = state.standardMode ? (state.standardLayout?.cols || 2) : (state.layout === 3 || state.layout === 6 ? 3 : 2)
    const rows = state.layout === 4 || state.layout === 6 ? 2 : 1
    const cw = previewW / cols, ch = previewH / rows
    const s = Math.max(cw / rw, ch / rh)
    const dw = img.width * s, dh = img.height * s
    const vw = (rot === 90) ? ch : cw, vh = (rot === 90) ? cw : ch
    const mX = Math.max(0, (dw - vw) / 2), mY = Math.max(0, (dh - vh) / 2)
    if (rot === 90) {
      if (mX > 0) photo.offXRatio = Math.max(-1, Math.min(1, -dy / mX))
      if (mY > 0) photo.offYRatio = Math.max(-1, Math.min(1, dx / mY))
    } else {
      if (mX > 0) photo.offXRatio = Math.max(-1, Math.min(1, -dx / mX))
      if (mY > 0) photo.offYRatio = Math.max(-1, Math.min(1, -dy / mY))
    }
    renderPreview()
  }, { passive: false })
  canvas.addEventListener('touchend', () => { if (dragging) { dragging = false; updateSlotControls() } })
}

// ===== 导出 =====

function calcExportDPI() {
  if (!state.highRes) return EXPORT_DPI
  let maxDPI = 300
  for (const p of state.photos) {
    if (p._img) {
      const imgDPI = Math.max(p._img.naturalWidth, p._img.naturalHeight) / Math.max(PAPER_W_MM, PAPER_H_MM) * 25.4
      maxDPI = Math.max(maxDPI, imgDPI)
    }
  }
  return Math.min(Math.max(Math.round(maxDPI), EXPORT_DPI), 3600)
}

function drawExportCell(ctx, photo, borderPx, x, y, cellW, cellH) {
  if (!photo || !photo._img) return
  const ix = x + borderPx, iy = y + borderPx
  const iw = Math.max(cellW - 2 * borderPx, 1), ih = Math.max(cellH - 2 * borderPx, 1)
  const img = photo._img; const rot = photo.rotation || 0
  // 圆角（毫米转像素）
  const rMm = { none: 0, small: 2, medium: 4, large: 8 }[state.cornerType] || 0
  const rPx = rMm / 25.4 * 600 // 600 DPI 导出
  ctx.save()
  if (rPx > 0) {
    ctx.beginPath()
    ctx.moveTo(ix + rPx, iy); ctx.lineTo(ix + iw - rPx, iy); ctx.quadraticCurveTo(ix + iw, iy, ix + iw, iy + rPx)
    ctx.lineTo(ix + iw, iy + ih - rPx); ctx.quadraticCurveTo(ix + iw, iy + ih, ix + iw - rPx, iy + ih)
    ctx.lineTo(ix + rPx, iy + ih); ctx.quadraticCurveTo(ix, iy + ih, ix, iy + ih - rPx)
    ctx.lineTo(ix, iy + rPx); ctx.quadraticCurveTo(ix, iy, ix + rPx, iy)
    ctx.closePath(); ctx.clip()
  } else { ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip() }
  ctx.translate(ix + iw / 2, iy + ih / 2)
  ctx.rotate(rot * Math.PI / 180)
  const rw = (rot === 90) ? img.height : img.width
  const rh = (rot === 90) ? img.width : img.height
  const s = Math.max(iw / rw, ih / rh)
  const dw = img.width * s, dh = img.height * s
  const vw = (rot === 90) ? ih : iw, vh = (rot === 90) ? iw : ih
  const mX = Math.max(0, (dw - vw) / 2), mY = Math.max(0, (dh - vh) / 2)
  ctx.drawImage(img, -dw / 2 + -(photo.offXRatio || 0) * mX, -dh / 2 + -(photo.offYRatio || 0) * mY, dw, dh)
  ctx.restore()
}

function createExportCanvas(dpi) {
  let ew = Math.round(PAPER_W_MM / 25.4 * dpi), eh = Math.round(PAPER_H_MM / 25.4 * dpi)
  if (ew * eh > 20000000) { const r = Math.sqrt(20000000 / (ew * eh)); ew = Math.round(ew * r); eh = Math.round(eh * r) }
  const canvas = document.createElement('canvas'); canvas.width = ew; canvas.height = eh
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ew, eh)
  return { canvas, ctx, ew, eh }
}

async function genCollagePage(batch, dpi) {
  const n = state.layout
  const { canvas, ctx, ew, eh } = createExportCanvas(dpi)
  const border = getBorderMM(state.borderType)
  const bp = border / 25.4 * dpi
  const { gap: gm, margin: mm, top: tm } = getLayoutProps(border)
  const ox = mm / 25.4 * dpi, oy = tm / 25.4 * dpi, gp = gm / 25.4 * dpi
  let cw, ch
  if (n === 2) { cw = ((PAPER_W_MM - mm * 2 - gm) / 2) / 25.4 * dpi; ch = (PAPER_H_MM - tm * 2) / 25.4 * dpi }
  else if (n === 3) { cw = ((PAPER_W_MM - mm * 2 - 2 * gm) / 3) / 25.4 * dpi; ch = (PAPER_H_MM - tm * 2) / 25.4 * dpi }
  else if (n === 4) { cw = ((PAPER_W_MM - mm * 2 - gm) / 2) / 25.4 * dpi; ch = ((PAPER_H_MM - tm * 2 - gm) / 2) / 25.4 * dpi }
  else { cw = ((PAPER_W_MM - mm * 2 - 2 * gm) / 3) / 25.4 * dpi; ch = ((PAPER_H_MM - tm * 2 - gm) / 2) / 25.4 * dpi }
  const poses = n === 2 ? [[ox, oy], [ox + cw + gp, oy]] :
    n === 3 ? [[ox, oy], [ox + cw + gp, oy], [ox + (cw + gp) * 2, oy]] :
    n === 4 ? [[ox, oy], [ox + cw + gp, oy], [ox, oy + ch + gp], [ox + cw + gp, oy + ch + gp]] :
    [[ox, oy], [ox + cw + gp, oy], [ox + (cw + gp) * 2, oy], [ox, oy + ch + gp], [ox + cw + gp, oy + ch + gp], [ox + (cw + gp) * 2, oy + ch + gp]]
  poses.forEach(([px, py], i) => { if (i < batch.length) drawExportCell(ctx, batch[i], bp, px, py, cw, ch) })
  if (state.showCutLine && n > 2) {
    ctx.save(); ctx.strokeStyle = '#ccc'; ctx.lineWidth = 4; ctx.setLineDash([16, 16]); ctx.beginPath()
    if (n === 3) { for (let c = 1; c < 3; c++) { const cx = ox + (cw + gp) * c - gp / 2; ctx.moveTo(cx, 0); ctx.lineTo(cx, eh) } }
    else if (n === 4) { ctx.moveTo(ox + cw + gp / 2, 0); ctx.lineTo(ox + cw + gp / 2, eh); ctx.moveTo(0, oy + ch + gp / 2); ctx.lineTo(ew, oy + ch + gp / 2) }
    else { for (let c = 1; c < 3; c++) { const cx = ox + (cw + gp) * c - gp / 2; ctx.moveTo(cx, 0); ctx.lineTo(cx, eh) }; ctx.moveTo(0, oy + ch + gp / 2); ctx.lineTo(ew, oy + ch + gp / 2) }
    ctx.stroke(); ctx.restore()
  }
  return canvas.toDataURL('image/png')
}

async function genStandardPage(batch, dpi) {
  const layout = state.standardLayout; if (!layout) return
  const { canvas, ctx, ew, eh } = createExportCanvas(dpi)
  const margin = layout.margin || 3, gap = layout.gap || 1.5
  const cw = layout.cellW / 25.4 * dpi, ch = layout.cellH / 25.4 * dpi
  const gp = gap / 25.4 * dpi, ox = margin / 25.4 * dpi, oy = margin / 25.4 * dpi
  let idx = 0
  for (let r = 0; r < layout.rows; r++) { for (let c = 0; c < layout.cols; c++) {
    if (idx >= batch.length) break
    drawExportCell(ctx, batch[idx], 0, ox + c * (cw + gp), oy + r * (ch + gp), cw, ch); idx++
  }}
  return canvas.toDataURL('image/png')
}

async function generate() {
  if (!state.photos.length) return
  const btn = $('genSaveBtn'); btn.disabled = true; btn.textContent = '加载图片...'
  let pageCount = 0
  try {
    for (const p of state.photos) { if (p.file && !p._img) p._img = await loadImage(p.url) }
    const exportDPI = calcExportDPI(); state.lastExportDPI = exportDPI
    const perPage = getPerPage(); pageCount = Math.max(1, Math.floor(state.photos.length / perPage))
    const allUrls = []; const progressWrap = $('progressWrap'); const progressBar = $('progressBar')
    progressWrap.style.display = 'block'; const startTime = Date.now()
    for (let page = 0; page < pageCount; page++) {
      const start = page * perPage, end = Math.min(start + perPage, state.photos.length)
      const batch = state.photos.slice(start, end).map(p => ({ ...p, _img: p._img }))
      const pct = Math.round((page / pageCount) * 100); progressBar.style.width = pct + '%'
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      btn.textContent = `生成中 ${page + 1}/${pageCount} · 已用 ${elapsed}s`
      await new Promise(r => setTimeout(r, 0))
      allUrls.push(state.standardMode ? await genStandardPage(batch, exportDPI) : await genCollagePage(batch, exportDPI))
    }
    progressBar.style.width = '100%'
    setTimeout(() => { progressWrap.style.display = 'none'; progressBar.style.width = '0%' }, 600)
    state.currentPage = 0; goToPage(0); showResult(allUrls)
    toast(`已生成 ${pageCount} 页`)
  } catch (e) { toast('生成失败: ' + e.message) }
  btn.style.display = 'none'
  $('postGenBtns').style.display = 'flex'
  $('regenBtn').textContent = `↻ 重新生成${pageCount > 1 ? ' ' + pageCount + '页' : ''}`
}


function showFullImage(idx) {
  if (idx < 0 || idx >= state.generated.length) return
  const overlay = document.createElement('div')
  overlay.className = 'full-image-overlay'
  overlay.innerHTML = '<div class="full-image-header"><button class="full-nav-btn" id="fullPrevBtn" ' + (idx <= 0 ? 'disabled' : '') + '>◀</button><span id="fullImageTitle">拼图 ' + (idx + 1) + '/' + state.generated.length + '</span><button class="full-close-btn">✕</button></div><div class="full-image-hint">请使用右上角 ✕ 关闭，勿按返回键</div><div class="full-image-wrap" id="fiw"><img src="' + state.generated[idx] + '" class="full-image" id="fi" draggable="false"></div><div class="full-image-footer"><button class="btn-secondary" id="fullPrevBtn2" ' + (idx <= 0 ? 'disabled' : '') + '>◀ 上一张</button><button class="btn-primary" id="fullSaveBtn">💾 保存</button><button class="btn-secondary" id="fullNextBtn2" ' + (idx >= state.generated.length - 1 ? 'disabled' : '') + '>下一张 ▶</button></div>'
  overlay.querySelector('.full-close-btn').onclick = () => overlay.remove()
  overlay.querySelector('#fullSaveBtn').onclick = () => { saveSingle(idx); overlay.remove() }
  const goPrev = () => { if (idx > 0) { overlay.remove(); showFullImage(idx - 1) } }
  const goNext = () => { if (idx < state.generated.length - 1) { overlay.remove(); showFullImage(idx + 1) } }
  ;[overlay.querySelector('#fullPrevBtn'), overlay.querySelector('#fullNextBtn'), overlay.querySelector('#fullPrevBtn2'), overlay.querySelector('#fullNextBtn2')].forEach((b, i) => { if (b) b.onclick = i < 2 ? goPrev : goNext })
  document.body.appendChild(overlay)
  // 缩放/拖动
  const wrap = document.getElementById('fiw')
  const img = document.getElementById('fi')
  if (!wrap || !img) return
  let s = 1, tx = 0, ty = 0, fitS = 1
  let psx = 0, psy = 0, ptx = 0, pty = 0
  let pinchData = null
  function fit() {
    const r = wrap.getBoundingClientRect()
    fitS = s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight) * 0.95
    tx = (r.width - img.naturalWidth * s) / 2; ty = (r.height - img.naturalHeight * s) / 2
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'
  }
  img.onload = fit
  setTimeout(fit, 200)
  function fitImage() { fit() }
  function clamp() {
    const r = wrap.getBoundingClientRect()
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s
    if (dw <= r.width) { tx = (r.width - dw) / 2 } else { tx = Math.max(r.width - dw, Math.min(0, tx)) }
    if (dh <= r.height) { ty = (r.height - dh) / 2 } else { ty = Math.max(r.height - dh, Math.min(0, ty)) }
  }
  function apply() { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')' }
  wrap.addEventListener('touchstart', (e) => {
    e.preventDefault()
    if (e.touches.length === 1) {
      psx = e.touches[0].clientX; psy = e.touches[0].clientY; ptx = tx; pty = ty
      pinchData = null
    } else if (e.touches.length === 2) {
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY)
      pinchData = { initS: s, initTx: tx, initTy: ty, initDist: dist, initMx: mx, initMy: my }
    }
  }, { passive: false })
  wrap.addEventListener('touchmove', (e) => {
    e.preventDefault()
    if (e.touches.length === 2 && pinchData) {
      const r = wrap.getBoundingClientRect()
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY)
      // 缩放 = 间距比例，平移 = 中点偏移，两者独立计算
      const ratio = dist / pinchData.initDist
      const newS = Math.max(fitS, Math.min(8, pinchData.initS * ratio))
      const panX = mx - pinchData.initMx
      const panY = my - pinchData.initMy
      // 先平移再围绕新中点缩放，保持中点下图像内容不变
      const pTx = pinchData.initTx + panX
      const pTy = pinchData.initTy + panY
      const imgMX = (mx - r.left - pTx) / pinchData.initS
      const imgMY = (my - r.top - pTy) / pinchData.initS
      s = newS; tx = mx - r.left - imgMX * s; ty = my - r.top - imgMY * s
      clamp(); apply()
    } else if (e.touches.length === 1) {
      tx = ptx + (e.touches[0].clientX - psx); ty = pty + (e.touches[0].clientY - psy)
      clamp(); apply()
    }
  }, { passive: false })
  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length === 1) {
      psx = e.touches[0].clientX; psy = e.touches[0].clientY; ptx = tx; pty = ty
      pinchData = null
    } else if (e.touches.length === 0) {
      pinchData = null
    }
  })
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = wrap.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const ratio = e.deltaY < 0 ? 1.1 : 0.9
    const ns = Math.max(fitS, Math.min(8, s * ratio))
    const ipx = (mx - tx) / s, ipy = (my - ty) / s
    s = ns; tx = mx - ipx * s; ty = my - ipy * s; clamp(); apply()
  }, { passive: false })
  let mPan = false, msx = 0, msy = 0, mtx = 0, mty = 0
  wrap.addEventListener('mousedown', (e) => { mPan = true; msx = e.clientX; msy = e.clientY; mtx = tx; mty = ty })
  document.addEventListener('mousemove', (e) => { if (!mPan) return; tx = mtx + (e.clientX - msx); ty = mty + (e.clientY - msy); clamp(); apply() })
  document.addEventListener('mouseup', () => { mPan = false })
}
function showResult(urls) {
  state.generated = urls; const grid = $('resultGrid'); grid.innerHTML = ''
  urls.forEach((u, i) => {
    const div = document.createElement('div'); div.className = 'result-item'
    div.innerHTML = '<img src="' + u + '">'; div.onclick = () => showFullImage(i)
    grid.appendChild(div)
  })
  $('resultSection').style.display = 'block'
}



async function saveSingle(idx) {
  const u = state.generated[idx]
  if (!u) return
  if (window.electronAPI) {
    await window.electronAPI.saveFile({ dataUrl: u, defaultName: genSaveName(idx), dpi: state.lastExportDPI })
    return
  }
  // 移动端：直接保存到相册
  if (state.isMobile && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
    await saveToGallery(u, genSaveName(idx))
    return
  }
  // 浏览器 fallback
  const a = document.createElement('a')
  a.href = u; a.download = genSaveName(idx); a.click()
  toast('已下载，请在「下载」文件夹查看')
}

async function saveAll() {
  if (!state.generated.length) return
  if (window.electronAPI) {
    const folder = await window.electronAPI.saveAll({ images: state.generated, dpi: state.lastExportDPI })
    if (folder) toast('已保存到: ' + folder)
    return
  }
  // 移动端：直接保存到相册
  let count = 0
  for (let i = 0; i < state.generated.length; i++) {
    const ok = await saveToGallery(state.generated[i], genSaveName(i))
    if (ok) count++
  }
  if (count > 0) { toast(`已保存 ${count} 张到相册`); return }
  // 浏览器 fallback
  for (let i = 0; i < state.generated.length; i++) {
    const a = document.createElement('a')
    a.href = state.generated[i]
    a.download = genSaveName(i)
    a.click()
    await new Promise(r => setTimeout(r, 200))
  }
  toast(`已下载 ${state.generated.length} 张，请在「下载」文件夹查看`)
}

async function saveToGallery(dataUrl, fileName) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')

  // 方案一：直接调用 Java GalleryBridge（MediaStore API，最可靠）
  if (window.GalleryBridge) {
    try {
      const result = window.GalleryBridge.saveImage(base64, fileName)
      if (result && result.startsWith('OK:')) {
        toast(`已保存到相册: ${fileName}`)
        return true
      }
      console.warn('GalleryBridge 失败:', result)
    } catch(e) {
      console.warn('GalleryBridge 异常:', e)
    }
  }

  // 方案二：Web Share
  if (navigator.share) {
    try {
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], fileName, { type: 'image/png' })
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '照片拼图器' })
        toast('已分享')
        return true
      }
    } catch(e) { if (e.name !== 'AbortError') console.warn('分享失败:', e) }
  }

  return false
}

// ===== 控件初始化 =====
function initControls() {
  // 布局
  document.querySelectorAll('#layoutBtns .control-btn').forEach(btn => {
    btn.onclick = () => {
      state.standardMode = false
      state.layout = parseInt(btn.dataset.n)
      document.querySelectorAll('#layoutBtns .control-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.querySelectorAll('#stdSizeBtns .control-btn').forEach(b => b.classList.remove('active'))
      calcStandardLayout()
      rebuild()
      saveSettings()
    }
  })

  // 标准尺寸
  buildStdSizes()
  calcStandardLayout()

  // 间距
  document.querySelectorAll('[data-border]').forEach(btn => {
    btn.onclick = () => {
      state.borderType = btn.dataset.border
      document.querySelectorAll('[data-border]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      renderPreview()
      saveSettings()
    }
  })

  // 圆角
  document.querySelectorAll('[data-corner]').forEach(btn => {
    btn.onclick = () => {
      state.cornerType = btn.dataset.corner
      document.querySelectorAll('[data-corner]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      renderPreview()
      saveSettings()
    }
  })

  // 反锐化
  document.querySelectorAll('[data-anti]').forEach(btn => {
    btn.onclick = () => {
      state.antiSharpen = parseInt(btn.dataset.anti)
      document.querySelectorAll('[data-anti]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      saveSettings()
    }
  })

  // 裁切线
  $('cutLineToggle').onchange = (e) => { state.showCutLine = e.target.checked; renderPreview(); saveSettings() }

  // 原画输出
  $('highResToggle').onchange = (e) => { state.highRes = e.target.checked; saveSettings() }

  // 翻页
  $('prevPageBtn').onclick = () => goToPage(state.currentPage - 1)
  $('nextPageBtn').onclick = () => goToPage(state.currentPage + 1)

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { goToPage(state.currentPage - 1); e.preventDefault() }
    else if (e.key === 'ArrowRight') { goToPage(state.currentPage + 1); e.preventDefault() }
  })

  // 窗口自适应
  window.addEventListener('resize', () => {
    initCanvas()
    renderPreview()
  })

  // 调试开关
  $('debugToggle').onchange = (e) => {
    state.debugMode = e.target.checked
    $('debugPanel').style.display = state.debugMode ? 'block' : 'none'
    if (state.debugMode) updateDebugInfo()
  }

  // 深色模式切换
  $('darkToggle').onclick = () => {
    document.body.classList.toggle('dark-mode')
    const isDark = document.body.classList.contains('dark-mode')
    $('darkToggle').textContent = isDark ? '☀️' : '🌙'
    state.darkMode = isDark
    saveSettings()
    try { localStorage.setItem('photoMosaicDark', isDark ? '1' : '0') } catch(e) {}
  }
  // 恢复上次的深色模式设置
  try {
    if (localStorage.getItem('photoMosaicDark') === '1') {
      document.body.classList.add('dark-mode')
      $('darkToggle').textContent = '☀️'
    }
  } catch(e) {}

  // 生成
  $('genSaveBtn').onclick = generate
  $('regenBtn').onclick = generate
  $('saveAllBtn').onclick = saveAll
  // 清空按钮
  const clearBtn = $('clearBtn')
  if (clearBtn) clearBtn.onclick = clearAllPhotos

  // 排序模式：切换 按拍摄时间 / 按选择顺序（切换后立即自动重排，无需刷新）
  const sortToggle = $('sortToggle')
  if (sortToggle) {
    sortToggle.onclick = async () => {
      state.sortMode = state.sortMode === 'time' ? 'order' : 'time'
      if (state.sortMode === 'time') {
        await sortPhotosByTime()
      } else {
        sortBySelectOrder()
      }
      syncSortUIControls()
      saveSettings()
    }
  }
  const sortDirBtn = $('sortDirBtn')
  if (sortDirBtn) {
    sortDirBtn.onclick = async () => {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc'
      await sortPhotosByTime()
      syncSortUIControls()
      saveSettings()
    }
  }
  const sortApplyBtn = $('sortApplyBtn')
  if (sortApplyBtn) {
    sortApplyBtn.onclick = async () => {
      if (state.photos.length < 2) { toast('至少需要 2 张照片'); return }
      if (state.sortMode === 'time') {
        await sortPhotosByTime()
        toast(state.sortDir === 'desc' ? '已按拍摄时间倒序排列' : '已按拍摄时间正序排列')
      } else {
        sortBySelectOrder()
        toast('已按选择顺序排列')
      }
      syncSortUIControls()
      saveSettings()
    }
  }
  // 点击交换顺序开关（仅手机端）
  const swapToggle = $('swapToggle')
  if (swapToggle) {
    swapToggle.onclick = () => {
      state.swapByTap = !state.swapByTap
      if (!state.swapByTap) {
        state.swapSelectedId = null
        renderPhotoList()
      }
      syncSwapUIControls()
      saveSettings()
    }
  }
  syncSortUIControls()
  syncSwapUIControls()
}

// 同步"点击交换顺序"开关状态（手机端显示，桌面端隐藏）
function syncSwapUIControls() {
  const b = $('swapToggle')
  if (!b) return
  b.style.display = state.isMobile ? '' : 'none'
  b.classList.toggle('active', !!state.swapByTap)
  b.textContent = state.swapByTap ? '⇄ 交换 开' : '⇄ 交换 关'
}

function calcMaxPerPage(w, h) {
  // 计算在 6 寸相纸 (148×100mm) 上最多能排多少个 w×h 的单元格
  const mt = [2, 3, 5], gt = [1, 1.5, 2]
  let best = 0
  for (const m of mt) {
    for (const g of gt) {
      for (const pair of [[w, h], [h, w]]) {
        const cols = Math.floor((PAPER_W_MM - 2 * m + g) / (pair[0] + g))
        const rows = Math.floor((PAPER_H_MM - 2 * m + g) / (pair[1] + g))
        best = Math.max(best, cols * rows)
      }
    }
  }
  return Math.max(best, 1)
}

function buildStdSizes() {
  const container = $('stdSizeBtns')
  STANDARD_SIZES.forEach((s, i) => {
    const btn = document.createElement('button')
    btn.className = 'control-btn sub-btn' + (i === state.standardIdx ? ' active' : '')
    const isLandscape = s.w > s.h
    const ratio = isLandscape ? (s.h / s.w) : (s.w / s.h)
    const iconH = 60, iconW = Math.max(22, Math.round(iconH / ratio))
    const dimText = `${s.w}×${s.h}`
    // 字号根据图标宽度和文本长度自适应，保证所有文字完整显示
    const fontSize = Math.min(20, Math.max(9, Math.round(iconW * 0.22)))
    const svg = `<svg width="${iconW}" height="${iconH}" viewBox="0 0 ${iconW} ${iconH}" style="vertical-align:middle;margin-right:4px;flex-shrink:0">
      <rect x="0" y="0" width="${iconW}" height="${iconH}" rx="1.5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="0.5" stroke-opacity="0.8"/>
      <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-weight="700" fill="currentColor">${dimText}</text>
    </svg>`
    const count = calcMaxPerPage(s.w, s.h)
    btn.innerHTML = svg + s.name + `<span style="font-size:11px;color:#999;margin-left:3px">×${count}</span>`
    btn.title = `${s.name} · ${s.w}×${s.h}mm · 每版${count}张`
    btn.onclick = () => {
      state.standardMode = true
      state.standardIdx = i
      document.querySelectorAll('#stdSizeBtns .control-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.querySelectorAll('#layoutBtns .control-btn').forEach(b => b.classList.remove('active'))
      calcStandardLayout()
      rebuildStandard()
      saveSettings()
    }
    container.appendChild(btn)
  })
}

function calcStandardLayout() {
  const std = STANDARD_SIZES[state.standardIdx]
  if (!std) return
  const mt = [2,3,5], gt = [1,1.5,2]
  let best = {total:0,cols:0,rows:0,cellW:std.w,cellH:std.h,label:'竖版',margin:3,gap:1.5}
  for(const m of mt){for(const g of gt){const cand=[{pw:std.w,ph:std.h,lb:'竖版'},{pw:std.h,ph:std.w,lb:'横版'}]
    for(const o of cand){const cols=Math.floor((PAPER_W_MM-2*m+g)/(o.pw+g)),rows=Math.floor((PAPER_H_MM-2*m+g)/(o.ph+g)),total=cols*rows
    if(total>best.total)best={total,cols,rows,cellW:o.pw,cellH:o.ph,label:o.lb,margin:m,gap:g}}}}
  if(best.total===0)best={total:1,cols:1,rows:1,cellW:PAPER_W_MM-10,cellH:PAPER_H_MM-10,label:'适应',margin:5,gap:0}
  state.standardLayout = best
  $('layoutDetail').textContent = state.standardMode
    ? `排版：${best.label} ${best.cols}x${best.rows}=${best.total}张/版 边距${best.margin}mm 间距${best.gap}mm`
    : ''
}

function updateControls() {
  const n = state.photos.length
  const perPage = state.standardMode ? (state.standardLayout?.total || 4) : state.layout
  const count = Math.floor(n / perPage)
  const btn = $('genSaveBtn')
  btn.disabled = n < perPage && state.photos.length > 0
  btn.textContent = n < perPage ? '需要 ' + perPage + ' 张照片' : (count > 0 ? '生成 ' + count + ' 张' : '生成拼图')
}

// ===== 调试信息 =====
function updateDebugInfo() {
  if (!state.debugMode) return
  const panel = $('debugPanel')
  const now = new Date()
  const ts = now.toTimeString().slice(0, 8)
  const mem = performance.memory ? `记忆体: ${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB / ${Math.round(performance.memory.jsHeapSizeLimit / 1048576)}MB` : ''
  let lines = [
    `[${ts}] 运行时状态`,
    `  预览区: ${previewW}×${previewH}px | 画布: ${CANVAS_W}×${CANVAS_H}px (${PREVIEW_DPI} DPI)`,
    `  已加载: ${state.photos.filter(p => p._img).length}/${state.photos.length} 张照片`,
    state.photos.length > 0 ? `  照片尺寸: ${state.photos.map(p => p._img ? `${p._img.naturalWidth}×${p._img.naturalHeight}` : '未加载').join(', ')}` : '',
    mem,
  ].filter(Boolean).join('<br>')
  // 添加最近的 toast 级日志
  if (state._logs && state._logs.length) {
    lines += '<br>' + state._logs.slice(-3).map(l => `  [${l.t}] ${l.msg}`).join('<br>')
  }
  panel.innerHTML = lines
  setTimeout(updateDebugInfo, 2000)
}

// 调试日志
function debugLog(msg) {
  if (!state._logs) state._logs = []
  state._logs.push({ t: new Date().toTimeString().slice(0, 8), msg })
  if (state._logs.length > 20) state._logs.splice(0, state._logs.length - 20)
}

// ===== 设置持久化 =====
const SAVE_KEYS = ['layout','borderType','cornerType','antiSharpen','showCutLine','highRes','standardMode','standardIdx','darkMode','sortMode','sortDir','swapByTap']

function saveSettings() {
  const data = {}
  SAVE_KEYS.forEach(k => data[k] = state[k])
  try { localStorage.setItem('photoMosaicSettings', JSON.stringify(data)) } catch(e) {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('photoMosaicSettings')
    if (!raw) return
    const data = JSON.parse(raw)
    SAVE_KEYS.forEach(k => { if (k in data) state[k] = data[k] })
    // 恢复深色模式
    if (state.darkMode) { document.body.classList.add('dark-mode'); const t = $('darkToggle'); if (t) t.textContent = '☀️' }
    return true
  } catch(e) { return false }
}

// ===== 启动 =====
function init() {
  console.log('init: start')
  try {
    const restored = loadSettings()
    console.log('init: loadSettings OK')
  } catch(e) { console.error('init: loadSettings FAIL:', e) }
  try { initCanvas(); console.log('init: initCanvas OK') } catch(e) { console.error('init: initCanvas FAIL:', e) }
  try { setupDragDrop(); console.log('init: setupDragDrop OK') } catch(e) { console.error('init: setupDragDrop FAIL:', e) }
  try { setupTrashZone(); console.log('init: setupTrashZone OK') } catch(e) { console.error('init: setupTrashZone FAIL:', e) }
  try { setupCanvasInteractions(); console.log('init: setupCanvasInteractions OK') } catch(e) { console.error('init: setupCanvasInteractions FAIL:', e) }
  try { initControls(); console.log('init: initControls OK') } catch(e) { console.error('init: initControls FAIL:', e) }
  try {
    const restored = loadSettings()
    if (restored) applySettingsToUI()
    const defaultBtn = document.querySelector(`#layoutBtns .control-btn[data-n="${state.layout}"]`)
    if (defaultBtn) defaultBtn.click()
    else document.querySelector('#layoutBtns .control-btn').click()
    if (restored) toast('已恢复上次设置')
    console.log('init: complete')
  } catch(e) { console.error('init: finalize FAIL:', e) }
}

function applySettingsToUI() {
  // 间距
  document.querySelectorAll('[data-border]').forEach(b => {
    b.classList.toggle('active', b.dataset.border === state.borderType)
  })
  // 圆角
  document.querySelectorAll('[data-corner]').forEach(b => {
    b.classList.toggle('active', b.dataset.corner === state.cornerType)
  })
  // ��锐化
  document.querySelectorAll('[data-anti]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.anti) === state.antiSharpen)
  })
  // 标准尺寸
  if (state.standardMode) {
    document.querySelectorAll('#stdSizeBtns .control-btn').forEach((b, i) => {
      b.classList.toggle('active', i === state.standardIdx)
    })
  }
  // 开关
  $('cutLineToggle').checked = state.showCutLine
  $('highResToggle').checked = state.highRes
  renderPreview()
}

document.addEventListener('DOMContentLoaded', init)
