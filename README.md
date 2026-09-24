# 🐳 ChatGPT-Codex-Bridge

> **白嫖 ChatGPT 网页版用不完的普通聊天额度，直接操控本地电脑工作区（改代码、读文件、跑终端），无需任何公网穿透！**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python: 3.7+](https://img.shields.io/badge/Python-3.7+-blue.svg)](https://www.python.org/)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-v4.0+-brightgreen.svg)](https://www.tampermonkey.net/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/)

---

## 💡 为什么做这个项目？

很多重度 AI 编程用户都会遇到一个痛点：
1. **Codex / API 的额度窗口极严**：5 小时或周额度经常飞速耗尽，价格昂贵且经常遇到 429 报错；
2. **ChatGPT 网页端普通聊天额度多到用不完**：但官方网页版却只能干聊，无法直接修改你本地电脑上的项目代码和运行测试；
3. **B 站常见教程方案繁琐且危险**：网上的教程清一色是「本地搭建 MCP ➔ 挂 Cloudflare Tunnel / ngrok 穿透公网 ➔ 配置 Custom Action Webhook」，不仅配置极其繁琐、网络延迟高，还把整台电脑的终端暴露到了公网上，极不安全。

**ChatGPT-Codex-Bridge 采用「浏览器本地回环」架构：**
* 网页端依然和 OpenAI 云端正常通讯，消耗普通的网页聊天配额；
* 浏览器里的油猴脚本自动拦截 AI 输出的工具指令，直接打给本机的 `127.0.0.1:9090` 执行；
* 本地执行完毕后，脚本自动将标准输出与报错贴回输入框发给 AI 继续迭代。
* **0 任何公网穿透、0 域名配置、0 节点流量消耗、纯内存级 127.0.0.1 本地回环！**

---

## 🏗️ 架构对比

### ❌ 传统方案（B 站常见公网穿透流）
```
OpenAI 云端 (美国) ────[公网 Webhook 回调]────> [Cloudflare Tunnel / ngrok 隧道] ────> 暴露你本地电脑 (高延迟 / 易断连 / 有安全隐患)
```

### ✅ 本项目方案（纯本地闭环流）
```
OpenAI 云端 (chatgpt.com)
       ▲  │ (正常网页聊天，消耗网页端聊天额度)
       │  ▼
本地浏览器 (Chrome / Edge 运行油猴脚本)
       ▲  │ (纯本地 127.0.0.1:9090 通信，0 穿透 / 0 延迟 / 数据不出内网)
       │  ▼
本地工作区执行器 (Python 轻量服务端)
       │
   [读写文件 / 运行终端命令 / 跑测试验证]
```

---

## ⚡ 真实血泪避坑指南（99% 的人卡住都在这里，必读！）

> **踩坑经验：** 如果安装完脚本后刷新网页没有任何反应、右下角没有绿灯，请立刻核对以下两点：

### ⚠️ 避坑 1：Edge 浏览器的「允许用户脚本」开关未开启！（头号大坑）
* **现象**：脚本代码粘贴了、油猴也开了，但在 `chatgpt.com` 网页右下角永远看不见控制岛。
* **原因**：微软 Edge 浏览器在最新的 Manifest V3 规范下，**默认静默拦截所有油猴脚本运行**！
* **解决办法**：
  1. 在 Edge 地址栏打开扩展管理页面：`edge://extensions/`
  2. 找到 **「篡改猴 (Tampermonkey)」**，点击 **「详细信息」**；
  3. 往下滑动找到 **【允许用户脚本】** 开关，**必须手动点击打开（变成绿色）**；
  4. 打开后再按 F5 刷新 ChatGPT 网页，右下角绿灯秒出！

### ⚠️ 避坑 2：千万别走错软件！是在【浏览器网页端】，不是【Windows 桌面端应用】！
* **现象**：打开了电脑上安装的 `ChatGPT.exe` 桌面客户端，纳闷为什么右下角没有绿灯。
* **原因**：油猴扩展是安装在 Edge/Chrome **浏览器**里的插件，独立的 Windows 客户端软件根本不支持浏览器扩展！
* **解决办法**：必须在 Edge 或 Chrome 浏览器标签页里打开官方网页版：`https://chatgpt.com/`！

### ⚠️ 避坑 3：黑窗口只要看到 🐳 就算成功，最小化放后台别关！
* 双击 `start_bridge.cmd` 后，看到黑窗口输出：
  `🐳 ChatGPT Web <-> Local Codex Bridge ... 等待浏览器油猴脚本连接并下发任务...`
  就代表本地执行器已经 100% 准备就绪，**最小化放后台即可**，千万不要点 ✖ 关闭它。

### ⚠️ 避坑 4：访问 chatgpt.com 还是需要正常开代理的！
* 打开 `chatgpt.com` 网页需要你的日常网络代理；
* 但网页脚本与本地工作区之间的执行通信（`127.0.0.1:9090`）是**纯本机回环**，不经过任何代理，不消耗任何节点流量。

---

## 🚀 极速上手使用（只需 3 步）

### 第一步：启动本地执行器
1. 确保电脑已安装 Python（3.7+ 均可，纯原生标准库，无需任何 `pip install`）。
2. 在解压后的文件夹内，双击运行：
   👉 **`start_bridge.cmd`**
3. 弹出黑窗口显示 `等待浏览器油猴脚本连接` 即可，最小化挂在后台。

### 第二步：安装浏览器油猴脚本（只需配置一次）
1. 浏览器安装扩展 **[篡改猴 (Tampermonkey)](https://www.tampermonkey.net/)**。
2. （*Edge 用户必做*）：进入 `edge://extensions/` ➔ 篡改猴详情 ➔ 开启 **【允许用户脚本】** 开关。
3. 打开本目录下的 **`ChatGPT-Codex-Bridge.user.js`** 文件，全选复制全部内容。
4. 点击浏览器右上角油猴图标 ➔ 选择 **「添加新脚本」** ➔ 清空默认文字 ➔ 粘贴进去 ➔ **Ctrl+S 保存**。
5. 打开或刷新 **https://chatgpt.com/**，网页右下角将立刻浮现悬浮控制胶囊：
   👉 **`🟢 Codex 本地桥: 已连通 (工作区就绪)`**

### 第三步：开工聊天（日常使用）
1. 在 `chatgpt.com` 网页端新建一个聊天会话。
2. 打开本目录下的 **`PROMPT.txt`**，复制里面的开工提示词发给 ChatGPT。
3. 从这一刻起，ChatGPT 就会自动变成一个**全自主编码智能体（Codex Agent）**：
   * **查看目录**：输出 ````tool:list```` ➔ 本地秒级扫描目录树自动发回；
   * **读取代码**：输出 ````tool:read main.py```` ➔ 本地带行号秒读自动回传；
   * **修改代码**：输出 ````tool:write src/app.py```` ➔ 本地自动写入文件；
   * **运行验证**：输出 ````tool:exec python test.py```` ➔ 本地自动执行并把终端 stdout/stderr 喂回给 AI。
4. 坐在屏幕前看着它全自动自我纠错、调试代码，直至任务彻底跑通！

---

## 🛠️ 文件清单

| 文件名 | 作用 |
|---|---|
| **`start_bridge.cmd`** | Windows 一键启动脚本，双击秒开本地服务 |
| **`codex_bridge.py`** | 本地执行器核心（零第三方依赖，纯标准库，提供安全执行与文件接口） |
| **`ChatGPT-Codex-Bridge.user.js`** | 浏览器端 Tampermonkey 脚本（v1.2 全面兼容 ChatGPT 最新语言标签渲染） |
| **`PROMPT.txt`** | 开工提示词模板，发给 ChatGPT 即可一键激活 Codex Agent 模式 |
| **`TIPS_操作指南.txt`** | 本地文本版操作与排错指南 |
| **`修复并打开ChatGPT.cmd`** | 附赠小工具：一键秒杀后台僵尸进程并救活 ChatGPT 桌面客户端 |

---

## 🔒 安全与隐私

* **纯本地通信**：所有针对文件的操作、终端命令只监听在 `127.0.0.1:9090`，外部网络无法访问你的执行器端口；
* **人工确认模式**：在网页右下角控制岛中，如果取消勾选 **「自动执行并回传」**，AI 的每一步操作都会进入挂起等待状态，只有你人工点击确认后才会执行，安全可控；
* **零凭证泄露**：不需要上传任何 API Key、不需要暴露公网 IP。

---

## 🙏 致谢与开源生态 (Acknowledgments)

本项目在设计与打磨过程中，深度参考并受益于 DeepSeek Harness (DSH) 社区诸多优秀的开源插件与工具实现，在此向以下开源作者致以崇高的敬意：

### 🤖 模型与订阅路由
* **[dsh-chatgpt-subscription](https://github.com/Aa728848/dsh-chatgpt-subscription)** by [@Aa728848](https://github.com/Aa728848)
  * *Codex 订阅接入与 Antigravity 多账号池轮换调度插件。*
* **[dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate)** by [@moon09300731](https://github.com/moon09300731)
  * *智能审批门控：利用轻量模型预判操作安全性，安全写入自动放行，危险操作转人工。*

### 🌐 联网与浏览器自动化
* **[dsh-free-search](https://github.com/DDDMUC/dsh-free-search)** by [@DDDMUC](https://github.com/DDDMUC)
  * *完全免费的多引擎免 Key 联网搜索插件（支持 Bing/DuckDuckGo/SearXNG 等）。*
* **[modsearch](https://github.com/liustack/modsearch)** by [@liustack](https://github.com/liustack)
  * *为 Coding Agent 打造的免注册全功能搜索与页面深度读取插件。*
* **[dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)** by [@Fisfzy](https://github.com/Fisfzy)
  * *基于 ego-lite 的结构化无头浏览器自动化与实时画面监控投屏套件。*

### 🛠️ 交互与桌面体验
* **[dsh-desktop-shell](https://github.com/RINGOLINK/dsh-desktop-shell)** by [@RINGOLINK](https://github.com/RINGOLINK)
  * *将 Web UI 一键封装为原生 Windows 桌面轻量应用（托盘驻留/无缝唤起）。*
* **[dsh-annotation](https://github.com/omdsh-dev/dsh-annotation)** by [@omdsh-dev](https://github.com/omdsh-dev)
  * *会话划词局部引用与交互式批注插件。*
* **[dsh-web](https://github.com/zhu1090093659/dsh-web)** by [@linxin666](https://github.com/zhu1090093659)
  * *DSH Web 功能全家桶（任务看板、Git 图谱、插件工坊、远程控制等）。*
* **[dsh-setting-restart](https://github.com/893413974-bit/dsh-setting-restart)** by [@893413974-bit](https://github.com/893413974-bit)
  * *通用设置一键优雅重启服务插件。*
* **[dsh-plugin-whale-fenggu](https://github.com/Mungbean-Cake/dsh-plugin-whale-fenggu)** by [@Mungbean-Cake](https://github.com/Mungbean-Cake)
  * *蓝色大肥鱼 · DeepSeek 北京时间峰谷计价实时盯梢看板。*

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源，欢迎提交 Issue 和 PR！
