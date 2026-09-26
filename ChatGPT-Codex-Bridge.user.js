// ==UserScript==
// @name         ChatGPT Web Codex 本地桥接
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  利用网页端普通聊天额度，直接操控本地电脑工作区（免公网穿透）
// @author       Antigravity
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// ==/UserScript==

// v1.7（2026-09-26）：新增三种渐变气泡（光谱渐变默认 / 冷色渐变 / 状态栏色块），配色取自 Claude Code 状态栏。
// v1.6（2026-09-26）：回传结果的蓝色气泡可改成深灰卡片（默认）/ 无底色 / 原样，只改回传结果，不动自己打的消息；
//   回传格式默认改回原版。
// v1.5（2026-09-26）：控制岛可切换回传格式（原版 / 纯文本 / 语法高亮 / 精简标题），选择会记住；
//   ChatGPT 现在把用户消息按 Markdown 渲染，回传结果里的代码框不再被当成新指令；
//   代码围栏比内容里最长的反引号串多一个，读含 ``` 的文件（如 PROMPT.txt）不会把代码框提前截断。
// v1.4（2026-09-26）：适配 ChatGPT 当天改版——消息不再带 data-message-author-role，
//   代码块从 <pre> 换成 div.CodeBlock-xxx（标签栏里单独一个 "tool:xxx" 文字），输入框没了 #prompt-textarea。
//   现在不依赖消息角色：页面上最后一条已发回的结果（"[本地执行完成 - tool:"）之后的最后一个工具代码块，就是待执行指令。
// v1.3 起的改动仍保留：
// 1. 同一条指令在新回复里再出现也会执行（v1.2 会静默跳过并卡住）
// 2. 刷新页面、切换会话时不自动执行页面上已有的指令；需要时点「▶ 执行」
// 3. 取消勾选「自动执行」后，点「▶ 执行」即人工确认
// 4. 填好结果后等发送按钮可用再点，认不出发送按钮就按回车；点完核对是否真的发出，失败原因留在控制岛上
// 5. 每一步都在 F12 控制台打印 [CodexBridge] 日志

(function () {
    'use strict';

    const BRIDGE_URL = 'http://127.0.0.1:9090';
    const MARK = '[本地执行完成 - tool:';   // 回传结果的开头，用来定位"上一轮到哪了"
    const MAX_FEEDBACK = 40000;   // 回传文本上限（字符），超出截断并告诉 GPT
    const STABLE_MS = 1500;       // 指令文本保持这么久不变才执行，防止流式输出还没结束

    // 回传文本格式（默认原版）
    const STYLES = { classic: '原版', plain: '纯文本', highlight: '语法高亮', compact: '精简标题' };
    // 回传结果所在气泡的外观；只改回传结果，不动用户自己打的消息
    const BUBBLES = {
        spectrum: '光谱渐变', cool: '冷色渐变', powerline: '状态栏色块',
        card: '深灰卡片', plain: '无底色', original: '原样（蓝色）'
    };
    // 渐变配色取自 Claude Code 状态栏（statusline.ps1）：光谱条、额度条、第一行分段底色
    const PALETTES = {
        spectrum: ['152,195,121', '97,175,239', '61,133,224', '229,192,123', '224,108,117', '198,120,221'],
        cool: ['97,175,239', '61,133,224', '198,120,221'],
        powerline: ['178,79,46', '180,138,58', '52,110,112', '120,85,135']
    };
    const grad = (cols, a) => `linear-gradient(135deg, ${cols.map(c => (a === undefined ? `rgb(${c})` : `rgba(${c}, ${a})`)).join(', ')})`;
    // 淡渐变底色保证文字清楚，1.5px 渐变描边用遮罩画在 ::before 上
    const gradientCss = Object.entries(PALETTES).map(([k, cols]) => `
        html[data-codex-bubble="${k}"] [data-codex-fb] {
            position: relative !important;
            background: ${grad(cols, 0.16)} !important;
            border-color: transparent !important;
            color: inherit !important;
        }
        html[data-codex-bubble="${k}"] [data-codex-fb]::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            padding: 1.5px;
            background: ${grad(cols)};
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            -webkit-mask-composite: xor;
            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            mask-composite: exclude;
            pointer-events: none;
        }`).join('');
    const BUBBLE_CSS = gradientCss + `
        html[data-codex-bubble="card"] [data-codex-fb] {
            background: rgba(127, 127, 127, 0.10) !important;
            border: 1px solid rgba(127, 127, 127, 0.28) !important;
            color: inherit !important;
        }
        html[data-codex-bubble="plain"] [data-codex-fb] {
            background: transparent !important;
            border-left: 3px solid rgba(127, 127, 127, 0.35) !important;
            border-radius: 0 !important;
            color: inherit !important;
        }`;
    // 语法高亮样式下，按扩展名给代码框标语言
    const LANG = {
        tex: 'latex', sty: 'latex', cls: 'latex', bib: 'bibtex', py: 'python', m: 'matlab',
        js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown', html: 'html', htm: 'html',
        css: 'css', sh: 'bash', ps1: 'powershell', bat: 'batch', cmd: 'batch', c: 'c', h: 'c',
        cpp: 'cpp', hpp: 'cpp', java: 'java', r: 'r', yml: 'yaml', yaml: 'yaml', toml: 'toml',
        xml: 'xml', sql: 'sql', ini: 'ini'
    };

    // ChatGPT 改版时优先改这里
    const SEL = {
        // 代码块外层容器：新版 div.CodeBlock-xxx，旧版 pre
        block: '[class*="codeblock" i], [class*="code-block" i], pre',
        composer: [
            '#prompt-textarea',
            'div.ProseMirror[contenteditable="true"]',
            '[role="textbox"][contenteditable="true"]',
            'form div[contenteditable="true"]',
            'form textarea'
        ],
        send: [
            'button[data-testid="send-button"]',
            'button#composer-submit-button[aria-label*="Send"]',
            'button#composer-submit-button[aria-label*="发送"]',
            'form button[aria-label*="Send"]',
            'form button[aria-label*="发送"]',
            'form button[type="submit"]'
        ],
        stop: [
            'button[data-testid="stop-button"]',
            'button[aria-label="Stop generating"]',
            'button[aria-label="停止生成"]',
            'form button[aria-label*="Stop"]',
            'form button[aria-label*="停止"]'
        ]
    };

    const log = (...a) => console.log('[CodexBridge]', ...a);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const visible = el => !!el && el.getClientRects().length > 0;

    // 按顺序试每个选择器，返回第一个可见元素
    function pick(list) {
        for (const s of list) {
            for (const el of document.querySelectorAll(s)) {
                if (visible(el)) return el;
            }
        }
        return null;
    }

    const isGenerating = () => !!pick(SEL.stop);
    const convRoot = () => document.querySelector('main') || document.body;
    // 控制岛和输入框里的文字不算对话内容
    const inUi = n => {
        const e = n.nodeType === 1 ? n : n.parentElement;
        return !e || !!e.closest('#codex-bridge-island, [contenteditable="true"], textarea');
    };
    // b 是否在 a 之后（文档顺序）
    const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    // 扫一遍对话区文字：已发回的结果、代码块标签（文字恰好是 tool:xxx）
    function scanText() {
        const feedback = [], labels = [];
        const tw = document.createTreeWalker(convRoot(), NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            const t = n.textContent;
            if (t.includes(MARK)) { if (!inUi(n)) feedback.push(n); }
            else if (/^\s*tool:[a-z]+\s*$/i.test(t) && !inUi(n)) labels.push(n);
        }
        return { feedback, labels };
    }

    // 取最外层的代码块容器（防止命中块内部同样带 CodeBlock 字样的子元素）
    function outerBlock(el) {
        let b = el && el.closest(SEL.block);
        while (b && b.parentElement) {
            const up = b.parentElement.closest(SEL.block);
            if (!up) break;
            b = up;
        }
        return b;
    }

    // 代码正文：优先 code 元素，其次滚动容器，最后整块文字去掉标签
    function blockBody(block, labelNode) {
        const notLabel = e => !labelNode || !e.contains(labelNode);
        const codes = [...block.querySelectorAll('code')].filter(notLabel);
        if (codes.length) return codes.reduce((a, c) => (c.innerText.length > a.length ? c.innerText : a), '');
        const sc = [...block.querySelectorAll('[class*="overflow-auto"], [class*="overflow-x-auto"], [class*="overflow-y-auto"], .cm-content')].find(notLabel);
        if (sc) return sc.innerText;
        const t = block.innerText;
        const lab = labelNode ? labelNode.textContent.trim() : '';
        const i = lab ? t.indexOf(lab) : -1;
        return i >= 0 ? t.slice(i + lab.length) : t;
    }

    // 代码块是否在回传结果消息里（用户消息现在按 Markdown 渲染，结果里的代码框也是代码块）
    function inFeedback(block) {
        let e = block.parentElement;
        for (let i = 0; i < 4 && e; i++, e = e.parentElement) {
            if (e.textContent.includes(MARK)) return true;
        }
        return false;
    }

    // 给回传结果所在的气泡打标记：从 MARK 文字往上找第一个有底色、有圆角、只含这一条结果的元素
    const clearBg = c => !c || c === 'transparent' || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c);
    function markBubbles() {
        for (const n of scanText().feedback) {
            const p = n.parentElement;
            if (!p || p.closest('[data-codex-fb]')) continue;
            for (let e = p, i = 0; e && e !== document.body && i < 8; e = e.parentElement, i++) {
                const cs = getComputedStyle(e);
                if (clearBg(cs.backgroundColor)) continue;
                if (parseFloat(cs.borderTopLeftRadius) > 0 && e.textContent.split(MARK).length === 2) {
                    e.setAttribute('data-codex-fb', '');
                }
                break;
            }
        }
    }

    // 页面上所有工具代码块，按文档顺序
    function toolBlocks(labels) {
        const found = new Map();
        const skip = new Set();
        // 1) 标签栏文字恰好是 tool:xxx（新版、旧版都有）；行内代码 `tool:xxx` 不在代码块里，会被排除
        for (const n of labels) {
            const b = outerBlock(n.parentElement);
            if (!b || found.has(b) || skip.has(b)) continue;
            if (inFeedback(b)) { skip.add(b); continue; }
            found.set(b, { action: n.textContent.trim().slice(5).toLowerCase(), label: n, via: 'label' });
        }
        // 2) code 的 language class 是 tool:xxx，或正文第一行是 tool:xxx
        for (const el of convRoot().querySelectorAll(SEL.block)) {
            const b = outerBlock(el);
            if (!b || found.has(b) || skip.has(b) || inUi(b)) continue;
            if (inFeedback(b)) { skip.add(b); continue; }
            const code = b.querySelector('code');
            const cls = code && typeof code.className === 'string' ? code.className : '';
            const cm = cls.match(/language-tool:([a-z]+)/i);
            if (cm) { found.set(b, { action: cm[1].toLowerCase(), via: 'class' }); continue; }
            const bm = blockBody(b, null).match(/^\s*(?:```)?tool:([a-z]+)[^\S\n]*(?:\n|$)/i);
            if (bm) found.set(b, { action: bm[1].toLowerCase(), via: 'body' });
        }
        return [...found.entries()]
            .map(([el, v]) => Object.assign({ el }, v))
            .sort((x, y) => (follows(x.el, y.el) ? -1 : 1));
    }

    // 待执行指令：最后一条已发回结果之后的最后一个工具代码块
    function pendingCall() {
        const { feedback, labels } = scanText();
        const lastFb = feedback[feedback.length - 1] || null;
        const blocks = toolBlocks(labels).filter(b => !lastFb || follows(lastFb, b.el));
        if (!blocks.length) return null;
        const blk = blocks[blocks.length - 1];
        let body = blockBody(blk.el, blk.label || null);
        if (blk.via === 'body') body = body.replace(/^\s*(?:```)?tool:[a-z]+[^\S\n]*\n?/i, '');
        const region = feedback.length + '|' + (lastFb ? lastFb.textContent.slice(0, 120) : '');
        const content = body.trim();
        return { action: blk.action, content, via: blk.via, sig: region + '::' + blk.action + '::' + content };
    }

    function init() {
        if (!document.body) {
            setTimeout(init, 300);
            return;
        }

        // 避免重复挂载
        if (document.getElementById('codex-bridge-island')) return;

        // 1. 创建右下角悬浮控制岛
        const island = document.createElement('div');
        island.id = 'codex-bridge-island';
        island.style.cssText = [
            'position: fixed',
            'bottom: 85px',
            'right: 20px',
            'z-index: 2147483647',
            'background: linear-gradient(135deg, rgba(20, 25, 45, 0.95), rgba(12, 16, 32, 0.98))',
            'color: #e2e8f0',
            'border: 1px solid rgba(59, 130, 246, 0.7)',
            'border-radius: 12px',
            'padding: 10px 14px',
            'font-size: 12px',
            'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55)',
            'display: flex',
            'flex-direction: column',
            'gap: 6px',
            'min-width: 180px',
            'max-width: 260px',
            'user-select: none'
        ].join(';');

        island.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-weight:700;color:#60a5fa;">Codex 本地桥 v1.7</span>
                <span id="codex-dot" style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;"></span>
            </div>
            <div id="codex-status-text" style="font-size:11px;color:#94a3b8;">正在连接 127.0.0.1:9090...</div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:2px;border-top:1px dashed rgba(255,255,255,0.15);padding-top:4px;">
                <label style="cursor:pointer;display:flex;align-items:center;gap:4px;font-size:11px;color:#cbd5e1;">
                    <input type="checkbox" id="codex-auto-run" checked style="accent-color:#3b82f6;"> 自动执行并回传
                </label>
                <button id="codex-run-now" title="执行最新的工具指令" style="cursor:pointer;font-size:11px;color:#e2e8f0;background:rgba(59,130,246,0.35);border:1px solid rgba(59,130,246,0.7);border-radius:6px;padding:1px 8px;">▶ 执行</button>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;color:#cbd5e1;">
                <span>回传格式</span>
                <select id="codex-style" style="cursor:pointer;font-size:11px;color:#e2e8f0;background:#1e293b;border:1px solid rgba(59,130,246,0.7);border-radius:6px;padding:1px 4px;">
                    ${Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;color:#cbd5e1;">
                <span>气泡样式</span>
                <select id="codex-bubble" style="cursor:pointer;font-size:11px;color:#e2e8f0;background:#1e293b;border:1px solid rgba(59,130,246,0.7);border-radius:6px;padding:1px 4px;">
                    ${Object.entries(BUBBLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
            </div>
        `;
        document.body.appendChild(island);

        const dot = document.getElementById('codex-dot');
        const statusText = document.getElementById('codex-status-text');
        const autoRunCheck = document.getElementById('codex-auto-run');
        const runNowBtn = document.getElementById('codex-run-now');
        const styleSelect = document.getElementById('codex-style');
        const bubbleSelect = document.getElementById('codex-bubble');

        // 两个样式选择存在 Tampermonkey 自己的存储里，刷新后保持
        const load = (key, def, table) => {
            try {
                const v = typeof GM_getValue === 'function' ? GM_getValue(key, def) : def;
                return table[v] ? v : def;
            } catch (e) { return def; }
        };
        const save = (key, v) => { try { if (typeof GM_setValue === 'function') GM_setValue(key, v); } catch (e) {} };

        let style = load('feedbackStyle', 'classic', STYLES);
        styleSelect.value = style;
        styleSelect.addEventListener('change', () => {
            style = styleSelect.value;
            save('feedbackStyle', style);
            log('回传格式改为', STYLES[style]);
        });

        const css = document.createElement('style');
        css.id = 'codex-bridge-css';
        css.textContent = BUBBLE_CSS;
        (document.head || document.documentElement).appendChild(css);
        const applyBubble = b => document.documentElement.setAttribute('data-codex-bubble', b);
        let bubble = load('bubbleStyle', 'spectrum', BUBBLES);
        bubbleSelect.value = bubble;
        applyBubble(bubble);
        bubbleSelect.addEventListener('change', () => {
            bubble = bubbleSelect.value;
            save('bubbleStyle', bubble);
            applyBubble(bubble);
            log('气泡样式改为', BUBBLES[bubble]);
        });
        setInterval(markBubbles, 1000);
        markBubbles();

        const C = { ok: '#86efac', info: '#60a5fa', warn: '#fde047', err: '#fca5a5' };
        function setStatus(text, color) {
            statusText.innerText = text;
            statusText.style.color = color || '#94a3b8';
        }

        // 心跳：只在连通状态变化时改文字，避免把报错信息盖掉
        let isConnected = false;
        function checkBridge() {
            GM_xmlhttpRequest({
                method: 'GET',
                url: BRIDGE_URL,
                timeout: 2500,
                onload: (res) => {
                    let ok = false;
                    try { ok = JSON.parse(res.responseText).status === 'running'; } catch (e) {}
                    ok ? setOnline() : setOffline();
                },
                onerror: setOffline,
                ontimeout: setOffline
            });
        }

        function setOnline() {
            dot.style.background = '#22c55e';
            dot.style.boxShadow = '0 0 8px #22c55e';
            if (!isConnected) {
                isConnected = true;
                setStatus('已连通 (工作区就绪)', C.ok);
                log('执行器已连通');
            }
        }

        function setOffline() {
            dot.style.background = '#ef4444';
            dot.style.boxShadow = 'none';
            if (isConnected) log('执行器断开');
            isConnected = false;
            setStatus('未运行 (请双击 start_bridge.cmd)', C.err);
        }

        setInterval(checkBridge, 4000);
        checkBridge();

        // 2. 基线：页面加载或切换到另一个已有会话时，页面上已有的待执行指令不自动执行
        const handled = new Set();
        let convId;                 // undefined 表示还没初始化
        let baselineAt = 0;
        let baselineDone = false;
        let pending = null;
        let busy = false;

        function currentConvId() {
            const m = location.pathname.match(/\/c\/([\w-]+)/);
            return m ? m[1] : null;
        }

        function refreshBaseline() {
            const id = currentConvId();
            // 新会话第一次拿到 id（null → id）不算切换，否则第一条 tool:list 会被当成历史
            if (convId === undefined || (id !== convId && convId !== null)) {
                handled.clear();
                pending = null;
                baselineDone = false;
                baselineAt = Date.now() + 2500;   // 等历史消息渲染完
                log('页面加载/切换会话，2.5 秒后检查页面上已有的指令', id);
            }
            convId = id;
            if (!baselineDone && Date.now() >= baselineAt) {
                baselineDone = true;
                if (isGenerating()) return true;   // 正在生成的是新回复，不算历史
                const call = pendingCall();
                if (call) {
                    handled.add(call.sig);
                    setStatus(`页面上有一条未执行的指令: ${call.action}（点 ▶ 执行）`, C.warn);
                    log('页面上已有未执行的指令，不自动执行', call.action, call.content.slice(0, 60));
                }
            }
            return baselineDone;
        }

        function checkTurn() {
            if (!isConnected || busy) return;
            if (!refreshBaseline()) return;
            if (isGenerating()) { pending = null; return; }

            const call = pendingCall();
            if (!call) { pending = null; return; }
            if (handled.has(call.sig)) return;
            if (!pending || pending.sig !== call.sig) {
                pending = { sig: call.sig, since: Date.now() };
                return;
            }
            if (Date.now() - pending.since < STABLE_MS) return;

            handled.add(call.sig);
            pending = null;
            log('识别到指令', call.action, '识别方式', call.via);

            if (!autoRunCheck.checked) {
                setStatus(`等待确认: ${call.action}（点 ▶ 执行）`, C.warn);
                return;
            }
            executeTool(call.action, call.content);
        }

        runNowBtn.addEventListener('click', () => {
            if (busy) return;
            const call = pendingCall();
            if (!call) {
                const { feedback, labels } = scanText();
                setStatus('没有待执行的指令（最后一条已回传过）', C.warn);
                log('▶ 没找到待执行指令。工具代码块数', toolBlocks(labels).length, '已回传结果数', feedback.length);
                return;
            }
            handled.add(call.sig);
            log('手动执行', call.action, '识别方式', call.via);
            executeTool(call.action, call.content);
        });

        // 3. 调本地执行器
        function executeTool(action, content) {
            busy = true;
            setStatus(`⚡ 本地执行: ${action}...`, C.info);

            const body = { action: action };
            if (action === 'exec') {
                body.command = content;
            } else if (action === 'read') {
                body.path = content;
            } else if (action === 'write') {
                const lines = content.split('\n');
                body.path = lines[0].trim();
                body.content = lines.slice(1).join('\n');
            }
            log('POST', action, body.path || body.command || '');

            GM_xmlhttpRequest({
                method: 'POST',
                url: BRIDGE_URL,
                data: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                timeout: 150000,
                onload: async (res) => {
                    let data;
                    try {
                        data = JSON.parse(res.responseText);
                    } catch (e) {
                        busy = false;
                        setStatus('✗ 执行器响应解析失败', C.err);
                        log('响应解析失败', res.status, String(res.responseText).slice(0, 200));
                        return;
                    }
                    setStatus('✓ 完成，正在发回网页...', C.info);
                    try {
                        await sendFeedback(buildFeedback(action, data, body, style));
                    } catch (e) {
                        setStatus('✗ 回传出错: ' + e.message, C.err);
                        log('回传出错', e);
                    }
                    busy = false;
                },
                onerror: () => {
                    busy = false;
                    setStatus('✗ 本地执行失败（执行器没响应）', C.err);
                    log('POST 失败');
                },
                ontimeout: () => {
                    busy = false;
                    setStatus('✗ 本地执行超时', C.err);
                    log('POST 超时');
                }
            });
        }

        // 代码围栏：比内容里最长的连续反引号多一个，文件里的 ``` 不会把代码框提前截断
        function fence(text, lang) {
            const longest = (text.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
            const f = '`'.repeat(Math.max(3, longest + 1));
            return f + (lang || '') + '\n' + text.replace(/\n$/, '') + '\n' + f + '\n';
        }

        // 按样式拼回传文本；四种样式的开头都是 MARK，PROMPT.txt 和识别逻辑不受影响
        function buildFeedback(action, res, req, style) {
            const notes = [];
            // 单段正文超长就截断，截断说明放在代码框外面
            const clip = text => {
                text = String(text || '');
                if (text.length <= MAX_FEEDBACK) return text;
                notes.push(`（内容过长已截断：共 ${text.length} 字符，只发了前 ${MAX_FEEDBACK} 字符）`);
                return text.slice(0, MAX_FEEDBACK);
            };
            const head = `${MARK}${action}]`;
            const lang = style === 'plain' || style === 'highlight' ? 'text' : '';
            let fb;

            if (style === 'classic') {
                // 原版（v1.2）格式
                fb = head + '\n';
                if (res.status === 'error') {
                    fb += `错误: ${res.message}\n`;
                } else if (action === 'exec') {
                    fb += `返回码: ${res.code}\n`;
                    if (res.stdout) fb += 'STDOUT:\n' + fence(clip(res.stdout));
                    if (res.stderr) fb += 'STDERR:\n' + fence(clip(res.stderr));
                    if (!res.stdout && !res.stderr) fb += '(无输出)\n';
                } else if (action === 'read') {
                    fb += `文件行数: ${res.total_lines}\n内容:\n` + fence(clip(res.content));
                } else if (action === 'write') {
                    fb += (res.message || '写入完成') + '\n';
                } else if (action === 'list') {
                    fb += `工作区: ${res.workspace}\n文件列表:\n` + fence((res.files || []).join('\n'));
                } else {
                    fb += JSON.stringify(res) + '\n';
                }
            } else if (res.status === 'error') {
                fb = `${head} 错误: ${res.message}\n`;
            } else if (action === 'exec') {
                fb = `${head} 返回码 ${res.code}\n`;
                if (res.stdout) fb += fence(clip(res.stdout), lang);
                if (res.stderr) fb += 'STDERR:\n' + fence(clip(res.stderr), lang);
                if (!res.stdout && !res.stderr) fb += '(无输出)\n';
            } else if (action === 'read') {
                const name = req.path || '';
                let text = clip(res.content);
                let readLang = '';
                if (style === 'plain') {
                    text = text.replace(/^(\s*\d+) \| /gm, '$1  ');      // 行号保留，去掉竖线
                    readLang = 'text';
                } else if (style === 'highlight') {
                    text = text.replace(/^\s*\d+ \| /gm, '');            // 去掉行号，按扩展名高亮
                    readLang = LANG[(name.split('.').pop() || '').toLowerCase()] || 'text';
                }
                fb = `${head} ${name} · ${res.total_lines} 行\n` + fence(text, readLang);
            } else if (action === 'write') {
                fb = `${head} ${res.message || '写入完成'}\n`;
            } else if (action === 'list') {
                const files = res.files || [];
                fb = `${head} ${res.workspace} · ${files.length} 个文件\n` + fence(files.join('\n'), lang);
            } else {
                fb = `${head}\n` + fence(JSON.stringify(res, null, 1), 'json');
            }
            return fb + (notes.length ? notes.join('\n') + '\n' : '');
        }

        // 4. 把结果填进输入框并发送
        function composerText(box) {
            return (box.tagName === 'TEXTAREA' ? box.value : box.innerText) || '';
        }

        function formButtons(box) {
            const f = box.closest('form');
            if (!f) return '找不到 form';
            return [...f.querySelectorAll('button')].filter(visible)
                .map(b => (b.getAttribute('aria-label') || b.innerText.trim() || '?') + (b.disabled ? '(禁用)' : ''))
                .join(' / ');
        }

        function fillComposer(box, text) {
            box.focus();
            if (box.tagName === 'TEXTAREA') {
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                setter.call(box, text);
                box.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            // contenteditable（ProseMirror）：全选后插入，替换输入框里的残留内容；
            // 先用 insertText 而不是粘贴，长文本粘贴可能被 ChatGPT 转成附件
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, text);
            if (!composerText(box).includes(MARK)) {
                try {
                    const dt = new DataTransfer();
                    dt.setData('text/plain', text);
                    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                } catch (_) {}
            }
        }

        async function sendFeedback(text) {
            const box = pick(SEL.composer);
            if (!box) {
                setStatus('✗ 找不到 ChatGPT 输入框（页面可能改版）', C.err);
                log('找不到输入框，试过的选择器:', SEL.composer);
                return;
            }
            const fbCount = scanText().feedback.length;
            fillComposer(box, text);
            const filled = composerText(box).includes(MARK);
            log('已填入输入框', text.length, '字符；输入框里能读到结果:', filled);

            // 等发送按钮可用，最多 20 秒；3 秒内一个发送按钮都认不出就不干等，改按回车
            let btn = null, seen = false;
            for (let i = 0; i < 80; i++) {
                await sleep(250);
                const b = pick(SEL.send);
                if (b) seen = true;
                if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { btn = b; break; }
                if (!seen && i >= 12) break;
            }
            if (btn) {
                log('点击发送按钮', btn.getAttribute('aria-label') || btn.getAttribute('data-testid'));
                btn.click();
            } else {
                log('没找到可用的发送按钮，改按回车。输入区按钮:', formButtons(box));
                box.focus();
                box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            }

            // 核对是否真的发出：对话里多了一条结果，或开始生成，或输入框被清空
            for (let i = 0; i < 20; i++) {
                await sleep(250);
                const cur = pick(SEL.composer);
                const cleared = filled && !(cur && composerText(cur).includes(MARK));
                if (scanText().feedback.length > fbCount || isGenerating() || cleared) {
                    setStatus('已发回，等待 GPT 思考...', C.ok);
                    log('回传成功');
                    return;
                }
            }
            setStatus('✗ 结果已填进输入框但没发出去，请手动点发送', C.err);
            log('回传未确认。输入区按钮:', formButtons(box), '输入框字数:', composerText(box).length);
        }

        setInterval(checkTurn, 700);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
