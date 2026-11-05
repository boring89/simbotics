# Simbotics · REBUILT

FRC 2026 賽季遊戲 **REBUILT** 的 3D 操駕模擬器，純靜態網頁（Three.js），不需要建置步驟，可以直接放上 GitHub Pages。僅供個人使用。

## 功能

- 完整場地：HUB、BUMP、TRENCH、TOWER、DEPOT、OUTPOST、Neutral Zone 的 FUEL
- 比賽流程：0:20 AUTO → 2:20 TELEOP（Transition、Shift 1–4 HUB 輪流啟用、Endgame）
- 計分：FUEL、TOWER（AUTO L1 15 分；結束時 L1/L2/L3 = 10/20/30），以及 Energized / Supercharged / Traversal RP
- 3v3 對戰（2 台電腦隊友 + 3 台電腦對手）、單人計時、自由練習；隊友與對手可分別設定 AI 難度（簡單／普通／困難／愛因斯坦／傳奇）與戰術
- 2026 真實機器人：254 Overload、1690 Kepler、4946 The Alpha Dogs（圓形底盤）、118 Artemis（雙砲塔）、4414 RIPCURRENT，各自有依照照片還原的 3D 模型與參數；3v3 時可在選單逐台指定隊友與對手開哪台機器人，選「隨機」則從還沒被選的真實機器人中抽
- 另有三台通用機器人：Balanced Swerve、Speedy Shuttle、Heavy Hopper（太高，不能鑽 TRENCH）
- 固定式射手（254）按住射擊會自動轉車頭瞄準（依剎車距離控制角速度，不會左右晃），沿炮管實際方向發射；雙砲塔（118）兩邊輪流射
- 砲塔自動瞄準並補償車速；離開 Alliance Zone 時改成把 FUEL 傳回己方區域
- 三種鏡頭（Driver Station／跟車／轉播），支援鍵盤與手把

## 操作

| 按鍵 | 手把 | 功能 |
| --- | --- | --- |
| WASD | 左搖桿 | 移動（相對鏡頭方向） |
| J / L、← / → | 右搖桿 | 旋轉 |
| Space / 滑鼠左鍵 | RT | 射擊 |
| Shift / K | LT | Intake（關閉自動吸球時） |
| I | X | 切換自動吸球 |
| C / X | A / B | TOWER 往上／往下爬 |
| V | Y | 切換鏡頭 |
| R | | 重新開始 |
| Esc / P | Start | 暫停 |

### 手機

選單「操作」預設自動偵測，觸控裝置會切到手機模式，直立、橫放都能玩：

- 左半邊螢幕拖曳：移動（搖桿出現在手指按下的位置）
- 右半邊螢幕拖曳：車頭朝向你指的方向
- 自動吸球；自動射擊會在己方區域內、HUB 啟用（或球落地前會啟用）時開火，固定射手會自己轉向 HUB
- 「射擊」按鈕：手動射擊，例如在區域外傳球
- 靠近 TOWER 時出現「攀爬」／「往下」按鈕；右上角有暫停、鏡頭、全螢幕
- 直立時 Driver Station 鏡頭會拉高，轉播鏡頭改成俯視

「自動射擊」也可以在電腦上勾選使用。

## 本機執行

ES modules 不能用 `file://` 開，需要一個簡單的伺服器：

```bash
python3 -m http.server 8080
```

然後打開 http://localhost:8080 。

## 部署到 GitHub Pages

1. 把這個資料夾推到一個 GitHub repo（例如 `simbotics`）。
2. Repo → **Settings → Pages** → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)`。
3. 等一分鐘左右，網址會是 `https://<你的帳號>.github.io/simbotics/`。

所有路徑都是相對路徑，Three.js 從 jsDelivr CDN 載入（`three@0.160.0`）。

## 程式結構

| 檔案 | 內容 |
| --- | --- |
| `js/config.js` | 場地尺寸、時間、計分、機器人參數、BUMP 高度函式 |
| `js/field.js` | 場地模型與碰撞盒 |
| `js/fuel.js` | FUEL 物理（固定物件池、空間網格碰撞、HUB 進球與出球） |
| `js/robot.js` | 機器人：swerve 驅動、矩形/圓形碰撞、intake、多砲塔彈道解算、攀爬 |
| `js/models.js` | 各機器人的 3D 模型 |
| `js/match.js` | 比賽時鐘、HUB Shift、計分與 RP |
| `js/ai.js` | 團隊大腦（角色分配）與各角色行為、繞路與脫困 |
| `js/input.js` | 鍵盤、手把與觸控輸入合併 |
| `js/touch.js` | 手機虛擬搖桿與按鈕 |
| `js/main.js` | 主迴圈、鏡頭、HUD、選單 |

## 電腦 AI 與戰術

每個聯盟有一個「團隊大腦」，每 0.25 秒依 HUB 輪替重新分配角色（機器人頭上會顯示，可在選單關閉）：

| 角色 | 做什麼 |
| --- | --- |
| 得分 | 己方 HUB 啟用時在 Alliance Zone 內連續射擊；砲塔機邊射邊撿區內的球、被頂時橫移閃避 |
| 囤球 | 己方 HUB 停用時把 hopper 裝滿；愛因斯坦級裝滿後會繼續吸球並把多的傳回己方區域，Neutral Zone 見底時改去 OUTPOST 拿 Human Player 的球 |
| 就位 | 啟用前依移動時間提早回到區域邊緣，按實際飛行時間提前開火，球落下時剛好啟用 |
| 供球 | 在 Neutral Zone 收球並吊傳進己方區域給得分手 |
| 防守 | 守住對手回家要走的 BUMP／TRENCH 通道，近距離卡位（不進對手 Alliance Zone）；沒目標時就清掉中場的球 |
| 反防守 | 把頂住隊友的防守機推開 |
| 搶球 | 進對手區域把他們囤的球吸走再傳回自己區域（斷糧） |
| 攀爬 | 困難以上每台在該出發的時間點比較：爬上去的分數（轉塔車路上還能把球射完）vs. 留下來還能射進的球（車上的球 + 依自己整場進球速度再跑一輪），划算才去爬 |

AUTO：先射完預載、只在己方半場掃球（依 Team Update 22 不越過中線），最弱的一台拿 DEPOT 後爬 L1。

收球（困難以上）：把場地切成 0.6 m 格子統計地上的球，選「球數 ÷ 來回時間」最高的一塊，朝球堆重心直線衝過去；貼牆的球會先擺正車頭再推進去。愛因斯坦級在 HUB 射空後會翻過 BUMP 守在自家 HUB 出球口接回剛射進的球。

254 式 BUMP 循環（固定式射手，困難以上）：車頭始終朝自家牆，停在 BUMP 上剛過區域線的位置用車尾滾筒射 HUB；射空後倒退下 BUMP 到 HUB 中場側，掃回自己射進後吐出來、被撞回 HUB 附近的球，再開回 BUMP 射擊。砲塔機不用這套。

傳奇難度：戰術同愛因斯坦，但機器人的速度、加速、吸球、射速比規格快 50%、精度更高——給已經能贏愛因斯坦的玩家用。

戰術：均衡（依情況）、全力進攻、供球、防守、斷糧；對手可設「隨機」。被對手碰撞時射擊精度下降，固定式射手無法開火，所以防守真的有用；困難以上的機器人也會避開被佔住的通道。

參考：Chief Delphi 上的 [Inactive Period Strategy](https://www.chiefdelphi.com/t/whats-the-best-inactive-period-strategy/512049)、[Ithaca 防守](https://www.chiefdelphi.com/t/rebuilt-2026-defense-the-ithaca-strategy/518957)、[賽季回顧](https://www.chiefdelphi.com/t/post-season-reflect-how-was-rebuilt/519847?page=10) 與 [Team Update 22](https://firstfrc.blob.core.windows.net/frc2026/Manual/TeamUpdates/REBUILT_TeamUpdate22.pdf)。

## 機器人資料來源

| 機器人 | 有公開資料的部分 | 估計值 |
| --- | --- | --- |
| 254 Overload | MK5n swerve、直線伸出全寬 intake、70+ 顆網狀 hopper、全寬滾筒射手 + 可調 hood（[team254.com](https://www.team254.com/frc/2026/)） | 速度、射速、攀爬 |
| 1690 Kepler | swerve、砲塔 + 可調 hood、齒輪傳動射輪、約 13 顆/秒、鑽 TRENCH、L1（[Chief Delphi](https://www.chiefdelphi.com/t/orbit-1690-2026-robot-reveal-kepler/515277)） | 容量、速度 |
| 4946 The Alpha Dogs | 圓形底盤與彎曲木層板 bumper、dye rotor + 滑環、中央塔式砲塔（[Chief Delphi](https://www.chiefdelphi.com/t/521568)） | 容量、速度、射速、攀爬 |
| 118 Artemis | 雙砲塔、Kraken X44 射輪 + hood 滾輪、伺服調 hood、中央 L1（[Chief Delphi](https://www.chiefdelphi.com/t/the-robonauts-118-2026-video/519037)） | 容量、高度、速度 |
| 4414 RIPCURRENT | 2026 世界冠軍、外板與 bumper 一體、dolphin tail dye rotor、pancake 砲塔（[Chief Delphi](https://www.chiefdelphi.com/t/4414-high-tide-behind-the-bumpers-2026/520190)） | 容量、速度、射速、攀爬 |

數值都在 `js/config.js` 的 `ROBOT_PRESETS`，模型在 `js/models.js`。

## 場地

尺寸依照 2026 Field Manual（v6）修正：場地 651.25 × 318.75 in；HUB、BUMP、TRENCH、DEPOT、TOWER、OUTPOST 的位置量自 AprilTag 配置圖（Figure 3-36），中場 FUEL 區依 Field Markings（中線 ±38 in、±103 in）。TOWER 是底板 + 兩根立柱、橫桿平行牆面；TRENCH 是 BUMP 末端的支撐塊加一支橫臂；OUTPOST 在聯盟牆後的角落，FUEL 從牆上開口滾進場。

## 說明

規則與尺寸是依照 2026 Game Manual 的大致數值簡化而成，不是官方模擬器，數字可能與正式規則有出入（例如沒有犯規判定、HUB 內部構造簡化）。想調整的話大多在 `js/config.js`。
