# 电视端适配交接说明

这份文件是给「换一台电脑继续干」用的。代码与结论都在 git 里，换机器不会丢；
丢的只有对话上下文，所以把关键的决定与验证方式写在这里。

## 仓库与分支

- fork：`https://github.com/zhoucc6-netizen/folia-sonnet`
- 分支：`feat/tv`（默认分支 `dev` 上只有一个 workflow 文件，用来让 Actions 页出现按钮）
- 上游：`maimai993/folia-sonnet`，AGPL-3.0
- 推 `feat/tv` 会自动触发 `Android TV Debug APK` 出包（debug 签名，可直接侧载）

```
git clone -b feat/tv https://github.com/<你的账号>/folia-sonnet.git
cd folia-sonnet
npm install --ignore-scripts      # 见下方「为什么是 --ignore-scripts」
```

## 这台机器上做过什么（按文件）

| 文件 | 作用 |
| --- | --- |
| `src/services/androidPhoneLayout.ts` | `DeviceType` 加 `'tv'`；电视判据（无精确指针 + maxTouchPoints 为 0）；4K 视口的根字号补偿 `tvViewportScaleFactor` |
| `src/styles/androidTv.css` | 电视档：3px 白色焦点环、滚动余量、app shell 5% overscan。全部由 `data-folia-device-resolved='tv'` 门控 |
| `src/styles/androidPhoneFit.css` | 补了 `html[data-folia-device-resolved='tv']` 一条，消费 `--folia-ui-scale-normal`（原来只有 phone / tablet 两条，电视档的变量设了没人读） |
| `src/components/app/tv/useSpatialNavigation.ts` | 方向键空间导航。捕获阶段管「有弹窗 / 已有 DOM 焦点」；冒泡阶段兜底管曲库墙的边界 → 进缝；菜单键直通墙↔缝；缝里按返回回墙 |
| `src/components/app/tv/TvKeyboard.tsx` + `tvKeyboardStore.ts` | 应用内虚拟键盘（电视没有可用系统输入法） |
| `src/stores/useTvKeyboardPreferenceStore.ts` | 「用电视自己的输入法」开关（`folia_tv_keyboard_off`） |
| `src/components/modal/settings/TvKeyboardSetting.tsx` | 上面那个开关的设置行，只在电视上出现 |
| `src/components/ponder/hold/usePagePonderShortcut.ts` | 电视上关掉 Ctrl+G（遥控器没有 Ctrl 和 G） |
| `android/.../FoliaNativePlugin.kt` | `startVoiceInput`：`RecognizerIntent` + `@ActivityCallback` |
| `src/platform/foliaNative.ts` | 语音桥的 Web 封装 `requestNativeVoiceInput` |
| `android/.../AndroidManifest.xml` | `LEANBACK_LAUNCHER`、`banner`、`touchscreen`/`leanback` 均 `required=false` |
| `android/.../res/drawable(-xhdpi)/tv_banner.png` | 电视桌面磁贴（没有 banner，应用在电视主屏不显示） |
| `.github/workflows/android-tv-debug.yml` | 推 `feat/tv` 或手动触发的 debug 出包 |
| `vite.config.ts` | `watch.ignored` 加 `**/android/**`、`**/*.tmpdir/**`（Windows 上 editor 原子保存会让 dev server EBUSY 崩掉） |

## 怎么验证（不用电视也能跑）

```powershell
npm run dev          # 需要先起 dev server，下面几条都打 localhost:3000
node test/manual/tv_probe.mjs            # 1920x1080 截图 + 设备能力
node test/manual/tv_dpad.mjs             # 两段：弹窗内导航、标签栏之间导航
node test/manual/tv_seam_probe.mjs       # 墙 → 缝、缝 → 墙
node test/manual/tv_keyboard_probe.mjs   # 键盘：Enter 打字、方向键换键、Esc 关闭
node test/manual/tv_4k_probe.mjs         # 1080p vs 4K 的根字号与截图
node test/manual/tv_focus_audit.mjs      # 可达性审计：手型但聚焦不到的元素
node test/manual/tv_perf_probe.mjs       # rAF 间隔、backdrop-filter 层数、canvas
```

探针用本机已装的 Edge（`channel: 'msedge'`），不需要 `npx playwright install`。
强制电视态的办法：预置 `localStorage.folia_device_type = 'tv'`，脚本里已经做了。

门禁：`npm run typecheck`、`npm run check:ui`、`npm run check:size` 必须全绿。

## 新机器环境

| 需要 | 说明 |
| --- | --- |
| Node ≥ 24 | 仓库 `engines` 与 `.nvmrc` 都钉了 24 |
| JDK 21 | Capacitor 8 的 android 库以 21 编译，17 会报「无效的源发行版」 |
| git | 国内下载 GitHub Releases 会失败，可用清华镜像 `github-release/git-for-windows/git` |
| Android SDK | 只在本机出包时需要；走 CI 出包则不必 |
| Edge | 探针用 `channel: 'msedge'`，需要本机有 Edge |

**为什么 `npm install --ignore-scripts`**：`sharp` 的 postinstall 要从 GitHub Releases 下 libvips，
国内网络会超时并中断整个安装；Web 层用不到它，跳过即可。

## 已知缺口（按影响排序）

1. **登录窗右侧扫码区不可聚焦**。浏览器 dev 版各平台显示「Web 端未配置 API」「仅桌面端可用」，
   右侧整块根本没渲染，所以本地复现不了。要等真包上电视后用同一个审计脚本跑真机状态，
   把那些 `div` 补成 `role="button"` + `tabIndex={0}` + 回车处理。
2. **语音未真机验证**。`RecognizerIntent` 需要电视上真装了语音识别服务；不可用时语音键会自己收起。
3. **菜单键的 keycode 未知**。代码认 `ContextMenu` / `Menu` 两个 key。若电视上按了没反应，
   用 `adb logcat` 抓真实 key，再补进 `DIRECTION_BY_KEY` 旁边那张表。
4. **整包单测有 13 个既有失败**（`prefetchNextSong` 一类），报的是 Node 里 `localStorage` 不可用，
   与电视改动无关；`test/unit/stores`、`test/unit/i18n`、`androidPhoneLayout` 全绿。

## 装包

```
adb uninstall top.izuna.foliamajor     # 必须先卸官方版：debug 签名不同，覆盖安装会 INSTALL_FAILED_UPDATE_INCOMPATIBLE
adb install -r folia-tv-debug-0.7.23.apk
```

卸载会清掉登录态、本地曲库索引与设置；云端歌单不受影响。

## 电视上逐项验

1. 搜索框 → 弹键盘 → 打两个字 → Esc 关闭且焦点回输入框
2. 墙面上按方向键走到边界 → 再按一次 → 焦点进中间那条控制条
3. 控制条里按返回 → 焦点回墙
4. 遥控器菜单键 → 一键切墙↔缝
5. 键盘上「语音」键是否出现、按了是否弹识别界面
6. 设置里关「毛玻璃」、关歌词可视化背景，对比帧率

## 帧率的结论（实测，别重复查）

桌面 Edge 上 226 帧 / 3 秒（≈75fps），p50 13ms、p95 14ms、超 25ms 的帧 0%。
同一页面常驻 **2 个 1280×720 canvas + 3 层 backdrop-filter**。
180Hz 面板不是原因——面板刷新率不会让一次绘制变便宜。真正贵的是这两个全屏效果，
电视 SoC 的 GPU 比桌面弱一个量级。**不要把 canvas 提到 4K**，那会把开销再翻四倍。
