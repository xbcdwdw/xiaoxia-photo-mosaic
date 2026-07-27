# 📸 照片拼图器 (Photo Mosaic)

一款跨平台的照片拼图工具，支持将多张照片拼合成一张 6 寸相纸（148×100mm）大小的拼图，适用于证件照排版、照片拼接等场景。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| **多排版** | 2张 / 3张 / 4张 / 6张 共四种排版 |
| **标准尺寸** | 小1寸(22×32) / 1寸(25×35) / 大1寸(33×48) / 小2寸(35×45) / 2寸(35×53) / 5寸3R(89×127) / 6寸4R(102×152) |
| **间距 & 圆角** | 无缝/1mm/2mm/4mm 间距，无/2mm/4mm/8mm 圆角 |
| **反锐化** | 0-3px 反锐化增强 |
| **裁切线** | 可开启虚线裁切线辅助裁剪 |
| **原画输出** | 按照片原始分辨率计算最佳 DPI 输出 |
| **预览微调** | 拖拽微调照片位置，右键/双击旋转 0°/90° |
| **翻页预览** | 多页拼图可左右切换预览 |
| **深色模式** | 顶栏 🌙/☀️ 一键切换 |
| **设置持久化** | 排版/间距/圆角等设置自动保存，下次打开自动恢复 |
| **保存到相册** | Android 端直接写入系统相册 Gallery |
| **键盘快捷键** | ← → 翻页 |

## 🖥 桌面版 (Electron)

### 依赖
- Node.js 22+
- npm

### 启动
```bash
cd photo-mosaic-desktop
npm install
npx electron .
```

### 打包
```bash
npx electron-builder --win portable
```

## 📱 移动版 (Android APK)

### 构建环境
- Android SDK（platform-tools + build-tools 35）
- JDK 21
- Node.js 22+
- Capacitor CLI

### 构建
```bash
npm install
npx cap copy android
cd android && ./gradlew assembleDebug
```

### 直接安装
APK 位于根目录 `照片拼图器-v1.0.apk`，传到手机上安装即可。

## 🏗 技术栈

| 平台 | 技术 |
|------|------|
| UI | Vanilla HTML + CSS + Canvas |
| 桌面端 | Electron + electron-builder |
| 移动端 | Capacitor + Android WebView |
| 相册保存 | 原生 MediaStore API (GalleryBridge) |
| 返回键 | Java onKeyDown + evaluateJavascript 回调 |

## 📁 项目结构

```
照片拼图器/
├── index.html            # 主页面
├── package.json          # 依赖配置
├── capacitor.config.json # Capacitor 配置
├── manifest.json         # PWA 清单
├── src/
│   ├── app.js            # 核心逻辑 (Canvas 渲染/手势/导出)
│   ├── style.css         # 样式 (含深色模式)
│   ├── main.js           # Electron 主进程
│   └── preload.js        # Electron preload 桥
├── android/
│   ├── build.gradle      # Android 构建配置
│   ├── AndroidManifest.xml
│   ├── java/             # Java 源码
│   └── res/              # 资源文件
├── build/
│   └── icon.png          # APP 图标
└── 照片拼图器-v1.0.apk   # Android APK
```

## 📝 历史

最初为微信小程序版，后迁移到桌面 Electron 应用，最终适配为 Android 移动端应用。

## 📄 开源协议

MIT
