const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow = null

function crc32(buf) {
  let crc = -1
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (crc ^ -1) >>> 0
}

function injectPhys(base64, dpi) {
  const raw = Buffer.from(base64, 'base64')
  const ppm = Math.round((dpi || 600) / 0.0254)
  const physData = Buffer.alloc(9)
  physData.writeUInt32BE(ppm, 0)
  physData.writeUInt32BE(ppm, 4)
  physData[8] = 1

  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(9, 0)
  const type = Buffer.from('pHYs')
  const crcInput = Buffer.concat([type, physData])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)

  const before = raw.subarray(0, 33)
  const after = raw.subarray(33)
  return Buffer.concat([before, lenBuf, type, physData, crcBuf, after])
}

function savePng(filePath, base64Data, dpi) {
  const buf = injectPhys(base64Data, dpi)
  fs.writeFileSync(filePath, buf)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 960,
    minHeight: 700,
    title: '照片拼图器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      navigateOnDragDrop: false,
    },
    show: false,
  })

  // 阻止文件拖入时导航（Electron 默认行为）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) event.preventDefault()
  })

  mainWindow.loadFile('index.html')
  mainWindow.once('ready-to-show', () => mainWindow.show())
}

// 保存图片
ipcMain.handle('save-file', async (event, { dataUrl, defaultName, dpi }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || '拼图.png',
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return null
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
  savePng(result.filePath, base64Data, dpi)
  return result.filePath
})

// 批量保存（带覆盖确认）
ipcMain.handle('save-all', async (event, { images, dpi }) => {
  const dir = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择保存目录',
  })
  if (dir.canceled || !dir.filePaths[0]) return false
  const folder = dir.filePaths[0]
  let bulkAction = null // 'overwrite' | 'rename' | null
  let renameOffset = 0 // 自动重命名时从最大序号+1开始
  for (let i = 0; i < images.length; i++) {
    const base64 = images[i].replace(/^data:image\/png;base64,/, '')
    let filePath = path.join(folder, `拼图_${i + 1}.png`)
    // 检查文件是否已存在
    if (fs.existsSync(filePath)) {
      const name = `拼图_${i + 1}`
      let action = bulkAction
      if (!action) {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '文件已存在',
          message: `"${name}.png" 已存在，如何处理？`,
          detail: `路径: ${filePath}${i < images.length - 1 ? '\n\n首次选择「全部...」会对剩余文件自动应用相同操作。' : ''}`,
          buttons: ['覆盖', '全部覆盖', '自动重命名', '全部重命名', '跳过'],
          defaultId: 0,
          cancelId: 4,
        })
        if (choice.response === 1) { action = 'overwrite'; bulkAction = 'overwrite' }
        else if (choice.response === 2) { action = 'rename' }
        else if (choice.response === 3) { action = 'rename'; bulkAction = 'rename' }
        else if (choice.response === 4) continue
        else action = 'overwrite'
      }
      if (action === 'rename') {
        // 扫描文件夹找最大序号，新文件全部往后排
        if (renameOffset === 0) {
          try {
            const files = fs.readdirSync(folder)
            for (const f of files) {
              const m = f.match(/^拼图_(\d+)\.png$/)
              if (m) renameOffset = Math.max(renameOffset, parseInt(m[1]))
            }
          } catch(e) {}
        }
        const newIdx = renameOffset + (i + 1)
        filePath = path.join(folder, `拼图_${newIdx}.png`)
      }
    }
    savePng(filePath, base64, dpi)
  }
  return folder
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
