# 📸 小夏同学照片拼图器 (Photo Mosaic)——适用于米家照片打印机（6寸相纸）或其他可能的兼容打印机

> 一款完全本地计算的跨平台照片拼图工具，专为 6 寸照片打印机（148×100mm）设计。
> 测试对象：**小米米家桌面照片打印机 1S / 2**。

## 🎯 项目背景

最初是为**微信小程序**设计的照片拼图工具，但在小程序后续审核添加了一些机制导致用户体验效果不良：

1. **图片审核机制**：只要调用上传图片api都需要经过微信的图片安全审核（哪怕是完全本地处理），且处理速度慢，稳定性一般
2. **功能限制**：小程序一次只能选9张图，对本地图片处理能力有限，高分辨率输出支持较差

因此开发了这个**独立版本**：

- ✅ **完全本地计算** — 所有图片处理在本地完成，不上传任何数据
- ✅ **更多照片选择** — 不受小程序 9 张限制
- ✅ **更高分辨率** — 支持 600 DPI 高精度输出
- ✅ **功能全面优化** — Canvas 实时预览、触屏手势、原生保存到相册
- ✅ **跨平台** — Windows 桌面版 + Android 移动版（本来是做了windows版本的，但是做完了才发现米家照片打印机2无法通过电脑无线连接打印，怒改app，exe等我下次有空上传）

## 🖨 适配打印机

| 打印机 | 说明 |
|--------|------|
| **小米米家桌面照片打印机 1S** | 6 寸相纸（148×100mm）|
| **小米米家桌面照片打印机 2** | 6 寸相纸，内置锐化较强 |

针对 **米家照片打印机 2** 的过度锐化问题，本工具提供了**反锐化（Anti-Sharpen）功能**（0-3px），在输出前对图像进行轻微模糊预处理，抵消打印机的二次锐化，获得更自然的输出效果。建议设置为 1-2px 进行测试。

推荐设置：
排版：4张
间距：1mm
圆角：2mm
反锐化：1px
裁切线：开
原画输出：关（打印机dpi不够，打印机dpi一般是300，这个默认不开原画给的是600，原画就是几乎完全无损（上千），内存多的随意）

## ✨ 功能

| 功能 | 说明 |
|------|------|
| **多排版** | 2张 / 3张 / 4张 / 6张 共四种排版 |
| **标准尺寸** | 小1寸(22×32) / 1寸(25×35) / 大1寸(33×48) / 小2寸(35×45) / 2寸(35×53) / 5寸3R(89×127) / 6寸4R(102×152) |
| **间距 & 圆角** | 无缝/1mm/2mm/4mm 间距，无/2mm/4mm/8mm 圆角 |
| **反锐化** | 0-3px 反锐化增强（针对米家打印机 2 的锐化问题） |
| **裁切线** | 可开启虚线裁切线辅助裁剪 |
| **原画输出** | 按照片原始分辨率计算最佳 DPI 输出 |
| **预览微调** | 拖拽/手指滑动微调照片位置，右键/双击旋转 0°/90° |
| **翻页预览** | 多页拼图可左右切换预览 |
| **排序模式** | 两种可选：按 EXIF 拍摄时间（正/倒序）或按选择顺序，一键切换、即时重排 |
| **点击交换** | 轻点选中照片再轻点另一张即交换顺序（独立开关，只识别点击） |
| **深色模式** | 顶栏 🌙/☀️ 一键切换 |
| **设置持久化** | 排版/间距/圆角等设置自动保存，下次打开自动恢复 |
| **保存到相册** | Android 端直接写入系统相册 Gallery |

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
从 [Releases](https://github.com/xbcdwdw/xiaoxia-photo-mosaic/releases) 页面下载最新 APK，传到手机上安装即可。


## 📁 项目结构

```
小夏同学照片拼图器/
├── index.html              # 主页面
├── package.json            # 依赖配置
├── capacitor.config.json   # Capacitor 配置
├── manifest.json           # PWA 清单
├── src/
│   ├── app.js              # 核心逻辑 (Canvas 渲染/手势/导出)
│   ├── style.css           # 样式 (含深色模式)
│   ├── main.js             # Electron 主进程
│   └── preload.js          # Electron preload 桥
├── android/
│   ├── build.gradle        # Android 构建配置
│   ├── AndroidManifest.xml
│   ├── java/               # Java 源码（包含 GalleryBridge）
│   └── res/                # 资源文件
├── build/
│   └── icon.png            # APP 图标
└── 照片拼图器-v1.0.apk     # Android APK
```

## ⚠️ 法律声明与免责条款

### 使用许可
- 本软件**仅供个人免费使用，严禁用于任何商业用途**
- 个人使用者可以自由下载、安装和使用本软件

### 免责声明

1. **无担保声明**：本软件按「现状」提供，不提供任何明示或暗示的担保，包括但不限于适销性、特定用途适用性和非侵权性。

2. **责任限制**：在任何情况下，开发者均不对因使用或无法使用本软件所产生的任何直接、间接、偶然、特殊或后果性损害承担责任，包括但不限于：
   - 照片打印效果不符合预期
   - 打印机设备损坏或故障
   - 数据丢失或损坏
   - 商业利益损失
   - 任何第三方索赔

3. **用户责任**：使用者应自行承担使用本软件的全部风险和责任。使用者需确保：
   - 拥有所处理照片的合法使用权
   - 打印内容不侵犯他人肖像权、著作权等合法权益
   - 遵守所在地法律法规

4. **打印机适配说明**：本软件针对 6 寸相纸（148×100mm）设计，已在小米米家桌面照片打印机 1S 和 2 上测试。其他品牌和型号的 6 寸打印机可能存在兼容性差异，使用者需自行验证。

5. **反锐化功能**：反锐化功能是为补偿米家照片打印机 2 的过度锐化而设计，不同打印机的锐化程度不同，效果可能有所差异。使用者需根据实际打印效果自行调整参数。

6. **协议变更**：开发者保留随时修改本声明条款的权利，修改后的条款一经发布即生效。

## 📜 开源协议

本项目采用 **Apache License 2.0** 开源协议。

```
Copyright [2026] [xbcdwdw]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
