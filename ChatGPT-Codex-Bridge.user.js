// ==UserScript==
// @name         ChatGPT Web Codex 本地桥接
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  利用网页端普通聊天额度，直接操控本地电脑工作区（免公网穿透）
// @author       Antigravity
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    const BRIDGE_URL = 'http://127.0.0.1:9090';

    function init() {
        if (!document.body) {
            setTimeout(init, 300);
            return;
        }

        // 避免重复挂载
        if (document.getElementById('codex-bridge-island')) return;

        // 1. 创建右下角悬浮控制岛（高优先级 z-index，半透明毛玻璃）
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
            'user-select: none'
        ].join(';');

        island.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-weight:700;color:#60a5fa;">🐳 Codex 本地桥</span>
                <span id="codex-dot" style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;"></span>
            </div>
            <div id="codex-status-text" style="font-size:11px;color:#94a3b8;">正在连接 127.0.0.1:9090...</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px;border-top:1px dashed rgba(255,255,255,0.15);padding-top:4px;">
                <label style="cursor:pointer;display:flex;align-items:center;gap:4px;font-size:11px;color:#cbd5e1;">
                    <input type="checkbox" id="codex-auto-run" checked style="accent-color:#3b82f6;"> 自动执行并回传
                </label>
            </div>
        `;
        document.body.appendChild(island);

        const dot = document.getElementById('codex-dot');
        const statusText = document.getElementById('codex-status-text');
        const autoRunCheck = document.getElementById('codex-auto-run');

        let isConnected = false;
        function checkBridge() {
            GM_xmlhttpRequest({
                method: 'GET',
                url: BRIDGE_URL,
                timeout: 2500,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.status === 'running') {
                            isConnected = true;
                            dot.style.background = '#22c55e';
                            dot.style.boxShadow = '0 0 8px #22c55e';
                            statusText.innerText = '已连通 (工作区就绪)';
                            statusText.style.color = '#86efac';
                            return;
                        }
                    } catch(e) {}
                    setOffline();
                },
                onerror: setOffline,
                ontimeout: setOffline
            });
        }

        function setOffline() {
            isConnected = false;
            dot.style.background = '#ef4444';
            dot.style.boxShadow = 'none';
            statusText.innerText = '未运行 (请双击 start_bridge.cmd)';
            statusText.style.color = '#fca5a5';
        }

        setInterval(checkBridge, 4000);
        checkBridge();

        // 2. 深度识别 ChatGPT 的工具调用（双通道匹配）
        let lastHandledSignature = '';

        function checkTurn() {
            if (!isConnected) return;

            // 必须在 GPT 停止生成后才执行，避免内容被分段截断
            const stopBtn = document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"], button[aria-label="停止生成"]');
            if (stopBtn) return;

            const toolCall = findLatestToolCall();
            if (!toolCall) return;

            const signature = toolCall.action + '::' + toolCall.content;
            if (signature === lastHandledSignature) return; // 防重复提交
            lastHandledSignature = signature;

            if (!autoRunCheck.checked) {
                statusText.innerText = `等待确认: ${toolCall.action}`;
                statusText.style.color = '#fde047';
                return;
            }

            executeTool(toolCall.action, toolCall.content);
        }

        function findLatestToolCall() {
            // 策略 A：扫描所有代码块（兼容截图中的语言标签栏模式）
            const pres = document.querySelectorAll('pre');
            if (pres.length > 0) {
                for (let i = pres.length - 1; i >= 0; i--) {
                    const pre = pres[i];
                    // 检查代码块顶部标签栏（例如截图中的 </> tool:list）
                    const header = pre.querySelector('div, span');
                    const headerText = header ? header.innerText.trim() : '';
                    const code = pre.querySelector('code');
                    const codeText = code ? code.innerText.trim() : '';

                    // 1) 语言栏直接出现 tool:xxx（如截图所示）
                    const hMatch = headerText.match(/tool:([a-z]+)/i);
                    if (hMatch) {
                        return { action: hMatch[1].toLowerCase(), content: codeText };
                    }

                    // 2) 语言 class 中有 tool:xxx
                    if (code && code.className) {
                        const cMatch = code.className.match(/language-tool:([a-z]+)/i);
                        if (cMatch) {
                            return { action: cMatch[1].toLowerCase(), content: codeText };
                        }
                    }

                    // 3) 代码正文中包含 ```tool:xxx
                    const bodyMatch = codeText.match(/^(?:```)?tool:([a-z]+)\n?([\s\S]*)/i);
                    if (bodyMatch) {
                        return { action: bodyMatch[1].toLowerCase(), content: bodyMatch[2].trim() };
                    }
                }
            }

            // 策略 B：最后兜底扫描最新一条 AI 消息的正文文本
            const msgs = document.querySelectorAll('[data-message-author-role="assistant"], div[class*="agent-turn"]');
            if (msgs.length > 0) {
                const lastMsg = msgs[msgs.length - 1];
                const text = lastMsg.innerText;
                const m = text.match(/(?:```)?tool:([a-z]+)(?:\n([\s\S]+?))?(?:```|$)/i);
                if (m) {
                    return { action: m[1].toLowerCase(), content: (m[2] || '').trim() };
                }
            }

            return null;
        }

        function executeTool(action, content) {
            statusText.innerText = `⚡ 本地执行: ${action}...`;
            statusText.style.color = '#60a5fa';

            let body = { action: action };
            if (action === 'exec') {
                body.command = content;
            } else if (action === 'read') {
                body.path = content;
            } else if (action === 'write') {
                const lines = content.split('\n');
                body.path = lines[0].trim();
                body.content = lines.slice(1).join('\n');
            } else if (action === 'list') {
                // 无额外参数
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: BRIDGE_URL,
                data: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        statusText.innerText = `✓ 完成，正在发回网页...`;
                        sendFeedback(action, data);
                    } catch(e) {
                        statusText.innerText = '响应解析失败';
                    }
                },
                onerror: () => {
                    statusText.innerText = '本地执行失败';
                }
            });
        }

        function sendFeedback(action, res) {
            let feedback = `[本地执行完成 - tool:${action}]\n`;
            if (action === 'exec') {
                feedback += `返回码: ${res.code}\n`;
                if (res.stdout) feedback += `STDOUT:\n\`\`\`\n${res.stdout}\n\`\`\`\n`;
                if (res.stderr) feedback += `STDERR:\n\`\`\`\n${res.stderr}\n\`\`\`\n`;
                if (!res.stdout && !res.stderr) feedback += `(无输出)\n`;
            } else if (action === 'read') {
                if (res.status === 'error') {
                    feedback += `错误: ${res.message}\n`;
                } else {
                    feedback += `文件行数: ${res.total_lines}\n内容:\n\`\`\`\n${res.content}\n\`\`\`\n`;
                }
            } else if (action === 'write') {
                feedback += res.message || '写入完成\n';
            } else if (action === 'list') {
                feedback += `工作区: ${res.workspace}\n文件列表:\n\`\`\`\n${res.files.join('\n')}\n\`\`\`\n`;
            }

            // 自动填充输入框并提交（兼容富文本 contenteditable 与剪贴板事件）
            const textarea = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            if (textarea) {
                textarea.focus();
                
                // 优先通过剪贴板事件模拟真实输入
                try {
                    const dt = new DataTransfer();
                    dt.setData('text/plain', feedback);
                    const pasteEvent = new ClipboardEvent('paste', {
                        clipboardData: dt,
                        bubbles: true,
                        cancelable: true
                    });
                    textarea.dispatchEvent(pasteEvent);
                } catch(_) {}

                // 兜底写入
                if (!textarea.innerText.includes('[本地执行完成')) {
                    document.execCommand('insertText', false, feedback);
                }

                setTimeout(() => {
                    const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                                    document.querySelector('button[aria-label*="Send"]') ||
                                    document.querySelector('button[aria-label*="发送"]');
                    if (sendBtn) {
                        sendBtn.click();
                        statusText.innerText = `已发回，等待 GPT 思考...`;
                    }
                }, 400);
            }
        }

        setInterval(checkTurn, 700);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
