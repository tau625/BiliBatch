# BiliBatch Development Rules

## Platform Target

- **日常开发统一按 Firefox 要求来做**
- manifest.json 使用 `background.scripts`（不用 `service_worker`）
- 需要发布 release 时，再通过 `scripts/build_release.py` 生成 Chrome 版（自动处理 `service_worker` / `browser_specific_settings` 等差异）
