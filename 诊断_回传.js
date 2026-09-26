// 回传故障诊断片段（只读，不改页面、不发消息）
// 用法：在出问题的 chatgpt.com 对话页（最新一条 AI 回复里有 tool:xxx 代码块）按 F12 → Console，
//      把本文件全部内容粘贴进去回车。Edge/Chrome 第一次往控制台粘贴会拦截，先手动输入 allow pasting 回车再粘贴。
// 结果会自动复制到剪贴板，直接粘贴回来即可。
(() => {
    const vis = el => !!el && el.getClientRects().length > 0;
    const tag = el => {
        if (!el || el.nodeType !== 1) return String(el && el.nodeName);
        const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
        const at = ['data-testid', 'data-message-author-role', 'data-message-id', 'data-language', 'role']
            .filter(a => el.hasAttribute(a)).map(a => `[${a}=${String(el.getAttribute(a)).slice(0, 24)}]`).join('');
        return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + at + (el.shadowRoot ? '(有shadowRoot)' : '');
    };
    const brief = el => el ? { el: tag(el), aria: el.getAttribute('aria-label') || undefined, disabled: (el.disabled || el.getAttribute('aria-disabled') === 'true') || undefined, visible: vis(el) } : null;
    // 元素骨架：最多 4 层、每层 6 个子元素，带自身文字
    const skel = (el, d = 0) => {
        if (!el || d > 4) return '';
        const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 40);
        let s = '  '.repeat(d) + tag(el) + (own ? `  "${own}"` : '') + '\n';
        for (const c of [...el.children].slice(0, 6)) s += skel(c, d + 1);
        return s;
    };
    // 遍历所有文本节点（穿透 open shadowRoot）
    const shadowHosts = [];
    const textNodes = [];
    const walk = root => {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let n = tw.currentNode; n; n = tw.nextNode()) {
            if (n.nodeType === 3) { if (/tool:[a-z]+/i.test(n.textContent)) textNodes.push(n); }
            else if (n.shadowRoot) { shadowHosts.push(tag(n)); walk(n.shadowRoot); }
        }
    };
    walk(document.body);
    const hit = textNodes.filter(n => !n.parentElement || !n.parentElement.closest('#codex-bridge-island')).pop();
    const chain = [];
    for (let n = hit && hit.parentElement; n && chain.length < 16; ) {
        chain.push(tag(n));
        n = n.parentElement || (n.getRootNode() instanceof ShadowRoot ? (chain.push('--- shadow 边界 ---'), n.getRootNode().host) : null);
    }
    const attrHits = [];
    for (const el of document.querySelectorAll('main *')) {
        for (const a of el.attributes) if (/tool:[a-z]+/i.test(a.value) && attrHits.length < 4) attrHits.push(tag(el) + ' ' + a.name + '=' + a.value.slice(0, 40));
    }

    const roles = [...document.querySelectorAll('[data-message-author-role]')];
    const asst = roles.filter(m => m.getAttribute('data-message-author-role') === 'assistant');
    const last = asst[asst.length - 1];
    const composer = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
    const form = composer && composer.closest('form');
    let up = hit && hit.parentElement;
    for (let i = 0; i < 5 && up && up.parentElement; i++) up = up.parentElement;
    // 回传结果气泡：从最后一条"[本地执行完成 - tool:"往上，列出每层的底色、圆角、是否已被脚本标记
    const fbNodes = textNodes.filter(n => n.textContent.includes('[本地执行完成 - tool:') && n.parentElement && !n.parentElement.closest('#codex-bridge-island, [contenteditable="true"]'));
    const fbHit = fbNodes.pop();
    const bubbleChain = [];
    for (let e = fbHit && fbHit.parentElement, i = 0; e && i < 10; e = e.parentElement, i++) {
        const cs = getComputedStyle(e);
        bubbleChain.push(`${tag(e)} | 底色=${cs.backgroundColor} | 圆角=${cs.borderTopLeftRadius}${e.hasAttribute('data-codex-fb') ? ' | 已标记' : ''}`);
    }

    const r = {
        时间: new Date().toLocaleString(),
        岛状态: document.getElementById('codex-status-text')?.innerText,
        最后几条消息角色: roles.slice(-4).map(tag),
        tool文字命中数: textNodes.length,
        最后命中文字: hit ? hit.textContent.slice(0, 60) : '页面文本里找不到 tool:xxx',
        命中在最后一条AI消息内: !!(hit && last && last.contains(hit)),
        命中往上的父元素链: chain,
        命中上5层骨架: up ? skel(up) : null,
        属性里含tool: attrHits,
        shadow宿主: shadowHosts.slice(0, 5),
        main内iframe: [...document.querySelectorAll('main iframe')].map(f => tag(f) + ' src=' + String(f.getAttribute('src')).slice(0, 60)),
        全页pre数: document.querySelectorAll('pre').length,
        全页code数: document.querySelectorAll('code').length,
        最后AI消息骨架: last ? skel(last) : '无',
        气泡样式: document.documentElement.getAttribute('data-codex-bubble'),
        已标记回传气泡数: document.querySelectorAll('[data-codex-fb]').length,
        最后一条回传往上: fbHit ? bubbleChain : '页面上没有回传结果',
        输入框: brief(composer),
        输入区可见按钮: form ? [...form.querySelectorAll('button')].filter(vis).map(b => tag(b) + (b.disabled ? ' disabled' : '')) : '找不到 form'
    };
    try { copy(JSON.stringify(r, null, 1)); console.log('✓ 诊断结果已复制到剪贴板'); } catch (e) { console.log('复制失败，请手动复制下面的对象'); }
    return r;
})();
