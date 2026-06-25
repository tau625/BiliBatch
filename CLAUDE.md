# BiliBatch Development Rules

## Platform Target

- **日常开发统一按 Firefox 要求来做**
- manifest.json 使用 `background.scripts`（不用 `service_worker`）
- 需要发布 release 时，再通过 `scripts/build_release.py` 生成 Chrome 版（自动处理 `service_worker` / `browser_specific_settings` 等差异）

## Versioning (semver: MAJOR.MINOR.PATCH)

- **每次完成一次 debug** — PATCH 自动 +1（如 1.3.2 → 1.3.3）
- **实现一个新功能** — MINOR 自动 +1，PATCH 归零（如 1.3.2 → 1.4.0）
- **MAJOR 版本** — 由用户手动指定
