# BiliBatch｜B站字幕批量导入

B 站视频字幕批量导入工具，支持多集视频一键导入到 Obsidian。

## 功能

- B 站视频字幕批量抓取（支持多集视频）
- 字幕预览、复制 Markdown
- 下载字幕文件（`srt/txt`）
- 批量导入到 Obsidian（Local REST API）
- 自动识别分 P 视频，逐集导入

## 安装

### 从 Release 安装（推荐）

前往 [Releases](https://github.com/tau625/BiliBatch/releases) 下载最新版本的 zip 文件。

#### Chrome / Edge

1. 下载 `bilibatch-v1.2.0-chrome.zip`
2. 解压到任意文件夹
3. 打开 Chrome，地址栏输入 `chrome://extensions/`
4. 右上角开启 **开发者模式**
5. 点击 **加载已解压的扩展程序**
6. 选择解压后的 `bilibatch-v1.2.0-chrome` 文件夹
7. 安装完成，工具栏会出现 BiliBatch 图标

#### Firefox

1. 下载 `bilibatch-v1.2.0-firefox.zip`
2. 解压到任意文件夹
3. 打开 Firefox，地址栏输入 `about:debugging#/runtime/this-firefox`
4. 点击 **临时载入附加组件**
5. 选择解压后的 `manifest.json` 文件
6. 安装完成

> ⚠️ Firefox 临时加载的插件关闭浏览器后会消失，需要重新加载。

### 从源码安装

#### Chrome / Edge
1. 克隆仓库：`git clone https://github.com/tau625/BiliBatch.git`
2. 打开 `chrome://extensions/`
3. 开启「开发者模式」
4. 点「加载已解压的扩展程序」
5. 选择 `extension/` 目录

#### Firefox
1. 克隆仓库：`git clone https://github.com/tau625/BiliBatch.git`
2. 打开 `about:debugging#/runtime/this-firefox`
3. 点「临时加载附加组件」
4. 选择 `extension/manifest.json`

## 使用

1. 在 B 站视频页点击插件图标
2. 点「批量」按钮打开批量导入页面
3. 输入 BV 号（每行一个，或粘贴 B 站链接）
4. 点「解析 BV 号」预览视频信息
5. 点「开始批量导入」

## 依赖

- Obsidian 安装 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 插件
- 插件设置中配置好 API 地址和密钥

## 许可证

MIT License
