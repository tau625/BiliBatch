# BiliBatch｜B站字幕批量导入

B 站视频字幕批量导入工具，支持多集视频一键导入到 Obsidian。

## 功能

- B 站视频字幕批量抓取（支持多集视频）
- 字幕预览、复制 Markdown
- 下载字幕文件（`srt/txt`）
- 批量导入到 Obsidian（Local REST API）
- 自动识别分 P 视频，逐集导入

## 安装

### Chrome / Edge
1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点「加载已解压的扩展程序」
4. 选择 `extension/` 目录

### Firefox
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「临时加载附加组件」
3. 选择 `extension/manifest.json`

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
