import { TIMING, SCORE, RP } from '../config.js';
import { RULES, WEIGHT_LIMIT } from '../parts.js';

// The in-game rule book: a short, simplified summary of the 2026 game written for this sim
// (not the official manual).

export const MANUAL = [
  ['概述', `
    <p><b>REBUILT</b> 是 2026 賽季的遊戲。兩個聯盟（紅、藍）各三台機器人，在 54 × 27 ft 的場地上比賽。</p>
    <p>場上有幾百顆 <b>FUEL</b>（黃色的球）。機器人把 FUEL 撿起來，從己方區域射進自己的 <b>HUB</b> 得分，比賽最後爬上 <b>TOWER</b> 拿額外分數。</p>
    <ul><li>每個聯盟有一個 HUB、一座 TOWER、一個 DEPOT（地上的球堆）和一個 OUTPOST（人類球員從這裡把球滾進場）。</li>
    <li>場地中央是中立區，兩側各有 BUMP（凸起）和 TRENCH（低矮通道）。</li></ul>`],
  ['比賽流程', `
    <table><tr><th>階段</th><th>時間</th><th>說明</th></tr>
    <tr><td>AUTO</td><td>${TIMING.auto} 秒</td><td>機器人自己跑程式，不能操作。兩邊的 HUB 都啟用。</td></tr>
    <tr><td>Transition</td><td>${TIMING.transition} 秒</td><td>開始手動操作。兩邊 HUB 都啟用。</td></tr>
    <tr><td>Shift 1–4</td><td>各 ${TIMING.shift} 秒</td><td>HUB 輪流啟用。AUTO 得分較多的聯盟，Shift 1 時 HUB 先停用。</td></tr>
    <tr><td>Endgame</td><td>${TIMING.endgame} 秒</td><td>兩邊 HUB 都啟用，最後爬 TOWER。</td></tr></table>
    <p>HUB 停用時射進去的球不算分（剛停用的 3 秒內還算）。停用時先在己方區域囤球，等啟用再一次射完。</p>`],
  ['計分', `
    <table><tr><th>項目</th><th>分數</th></tr>
    <tr><td>FUEL 射進啟用中的 HUB</td><td>${SCORE.fuel} 分／顆</td></tr>
    <tr><td>AUTO 結束時在 TOWER L1</td><td>${SCORE.autoL1} 分</td></tr>
    <tr><td>比賽結束時 TOWER L1／L2／L3</td><td>${SCORE.levels.slice(1).join('／')} 分</td></tr></table>
    <p>資格賽的 Ranking Points：贏 3 RP、平手 1 RP，另外：</p>
    <ul><li>Energized：聯盟 FUEL ≥ ${RP.energized}</li><li>Supercharged：聯盟 FUEL ≥ ${RP.supercharged}</li><li>Traversal：TOWER 分數 ≥ ${RP.traversal}</li></ul>`],
  ['場地元素', `
    <ul>
    <li><b>HUB</b>：方形的得分塔，開口在 72 in 高。只能從己方區域射進自己的 HUB；在區域外射出的球算傳球。</li>
    <li><b>TOWER</b>：靠近己方牆的攀爬架，有三層橫桿（L1／L2／L3）。</li>
    <li><b>TRENCH</b>：場地兩側的低矮通道，淨高 ${RULES.trench} in。機器人太高就鑽不過，只能走 BUMP。</li>
    <li><b>BUMP</b>：HUB 兩旁的斜坡，任何機器人都能開過去，但會減速。</li>
    <li><b>DEPOT</b>：己方牆邊地上的一堆 FUEL。</li>
    <li><b>OUTPOST</b>：人類球員從這裡把 FUEL 滾給機器人。把 intake 對準出球口就會有球。</li></ul>`],
  ['機器人規則', `
    <table><tr><th>限制</th><th>數值</th></tr>
    <tr><td>框架周長</td><td>≤ ${RULES.perimeter} in</td></tr>
    <tr><td>高度</td><td>≤ ${RULES.height} in</td></tr>
    <tr><td>伸出框架外</td><td>≤ ${RULES.extension} in（intake 等機構）</td></tr>
    <tr><td>重量</td><td>≤ ${WEIGHT_LIMIT} lb（不含 bumper 與電池）</td></tr></table>
    <ul><li>機器人四周要有 bumper，上面印隊號，紅藍兩色可換。</li>
    <li>電控要用規定的主控制器、電源分配板和無線電，主電源要有斷路器。</li>
    <li>馬達只能用規定的型號（本遊戲：Kraken X60、NEO Vortex、NEO）。</li></ul>`],
  ['建造建議', `
    <ul>
    <li><b>先求能動。</b>底盤、驅動、電控、bumper 做完就能上場；其他機構再慢慢加。</li>
    <li><b>早點下單。</b>Swerve 模組運送要一週，馬達四五天。</li>
    <li><b>機台決定做法。</b>沒有 CNC 也能用帶鋸加台鑽手工做鋁件，只是比較慢、精度看手藝。做不來的可以外包給 QuickCut。</li>
    <li><b>品質會影響表現。</b>零件尺寸不準、組裝鬆脫，機器人會比較慢、射得比較散。</li>
    <li><b>留時間練習。</b>操駕時數會讓上場表現更好。</li></ul>`],
  ['加工小抄', `
    <table><tr><th>機台</th><th>重點</th></tr>
    <tr><td>帶鋸機</td><td>先量好、劃線，鋸片對準線的外側（廢料那一邊）。送料穩定，不要硬推。</td></tr>
    <tr><td>台鑽</td><td>對準中心點再下鑽。鋁件小鑽頭用高轉速。每鑽一段就退一下排屑。</td></tr>
    <tr><td>車床</td><td>先開主軸再進刀。每刀吃深不要超過 0.04 in（半徑）。先車端面，再車外徑，最後切斷。用卡尺量。</td></tr>
    <tr><td>CNC</td><td>夾具不要擋到刀具路徑。XY 歸零到板材左下角，Z 用紙張法對刀。每刃進給量 0.04–0.08 mm。</td></tr>
    <tr><td>3D 印表機</td><td>先調平熱床：四個角都要剛好能拖動紙張。填充率越高越堅固，但越久。</td></tr>
    <tr><td>工作台</td><td>銼刀順著邊緣、穩定地推。攻牙每轉半圈要倒轉一點斷屑。</td></tr></table>`],
];
