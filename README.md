# YiChen ToDo

![License](https://img.shields.io/badge/license-MIT-0FDC78)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-52525B)
![Languages](https://img.shields.io/badge/i18n-2%20now%2C%2015%20planned-0FDC78)
![Status](https://img.shields.io/badge/status-v0.1.0%20preview-EFAA17)

> A desktop to-do app that stays out of your way.
> Most of the time it is just a tiny draggable marker on your desktop — click it and the panel unfolds.

Local-first. No account. No cloud service. 15 languages. MIT licensed.

[中文说明](README.zh-CN.md) · [Feature modules (中文)](docs/FEATURES.md) · [Architecture plan (中文)](docs/ARCHITECTURE.md)

---

## What makes it different

- **Invisible by default** — When idle, the app is only a small marker (dot / capsule / icon) you can drag anywhere on the desktop. It disappears completely from the taskbar when collapsed. Click to unfold, click away to hide.
- **The marker is a dashboard** — A progress ring shows today's completion, and the color tells you risk at a glance: normal, due soon, overdue.
- **Zero interruption** — No account, no subscription, no ads, no telemetry. Notifications are the only interruption, and you can turn them off.
- **Native-grade localization** — 15 languages including right-to-left Arabic, with ICU plurals, localized dates, relative times and week-start rules. Not a handful of translated strings.
- **Your data stays yours** — Local SQLite. Optional sync through any folder you already sync (OneDrive, Dropbox, iCloud Drive, NAS). One-click encrypted bundle export for moving to a new device.

## Download

The first build is on the [Releases page](https://github.com/2268027569/DoList/releases).

- **Windows 10/11 (64-bit):** `YiChen-ToDo-Setup-0.1.0-x64.exe` (installer) or `YiChen-ToDo-Portable-0.1.0-x64.exe`
- **macOS 11+:** `YiChen-ToDo-0.1.0-arm64.dmg` for Apple Silicon or `YiChen-ToDo-0.1.0-x64.dmg` for Intel

These builds are **not code-signed yet**, so Windows SmartScreen and macOS Gatekeeper will warn on first launch (Windows: More info → Run anyway; macOS: right-click the app → Open). Signing certificates are the remaining piece of M11.

## Status

**v0.1.0 preview.** The marker, panel, task core (lists, priorities, due dates, subtasks, recurrence, undo), reminders with their own popups, the task detail window, themes with system acrylic/vibrancy and the scoreboard clock all work. Still ahead: the remaining 13 launch languages (English and 简体中文 ship today), folder sync, auto-update, and signed/notarized builds.

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml) on every `v*` tag: Windows x64 installer + portable, macOS dmg/zip for both architectures, uploaded to one GitHub Release.

## Feature modules

13 modules in total, each item tagged **P0** (MVP), **P1** (before 1.0) or **P2** (after 1.0). Full detail lives in [docs/FEATURES.md](docs/FEATURES.md).

| Module | Scope |
|---|---|
| M01 Marker & window shell | Draggable marker, edge snapping, auto-hide at screen edge, unfold animation, multi-monitor |
| M02 Task core | Tasks, subtasks, recurrence (RRULE), priorities, reminders, drag-and-drop ordering, undo |
| M03 Views & organization | Smart lists, custom lists, tags, grouping, filters, search, archive |
| M04 Reminders | Native notifications, lead time, overdue and daily digest, do-not-disturb |
| M05 Focus & insights | Today's top 3, streaks, statistics, optional Pomodoro |
| M06 Internationalization | 15 languages, ICU plurals, RTL, timezone, CI key checks |
| M07 Appearance | Light/dark/system, built-in themes, custom accent, acrylic, privacy mode |
| M08 Data, sync & migration | SQLite, backups, import/export (JSON/CSV/Markdown/ICS), folder sync, device migration |
| M09 System integration | Global hotkeys, tray, auto-start, single instance, `yichen-todo://` protocol, drag-and-drop capture |
| M10 Settings | Marker, panel, defaults, reminders, data, hotkeys, about (credited to YiChen) |
| M11 Update & distribution | Auto-update, NSIS + dmg/zip, code signing and macOS notarization |
| M12 Open source | LICENSE, dual README, contribution docs, third-party notices, CI |
| M13 QA | Unit tests, Electron E2E, manual acceptance matrix, performance budget |

Explicitly out of scope: team collaboration, kanban/Gantt project management, accounts and cloud backend, subscription plans, mobile apps.

## Roadmap

| Milestone | Contents |
|---|---|
| M0 | Project scaffold: electron-vite + TypeScript + React + theme tokens |
| M1 | Marker window, drag, edge snapping, unfold animation, panel shell |
| M2 | Task CRUD, SQLite layer, core views, hotkeys |
| M3 | i18n framework, 15 launch languages, themes, settings |
| M4 | Reminders, recurrence, tray, auto-start, auto-update |
| M5 | Open-source package, signed builds, v1.0 release |
| M6 | Differentiators: natural-language capture, edge auto-hide, focus mode, privacy mode |

## Planned stack

Electron (official stable) · electron-vite · TypeScript · React · Tailwind CSS with CSS-variable theme tokens · Zustand · better-sqlite3 · i18next + ICU MessageFormat · electron-builder · electron-updater · Vitest + Playwright for Electron.

## Documentation language

Project docs are **Chinese-first** for now (the owner's primary language). English translations of `docs/` are welcome as contributions once the codebase is public.

## Contributing

Issues and pull requests are welcome. Before you start, please read the [contribution guide](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md) and the [security policy](SECURITY.md).
Change history lives in the [changelog](CHANGELOG.md); third-party licenses are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © 2026 YiChen.

Distributed builds bundle Electron, Chromium and Node.js, whose license texts must ship with every release and are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Author

YiChen · GitHub [@2268027569](https://github.com/2268027569) · Repository: [2268027569/DoList](https://github.com/2268027569/DoList)
