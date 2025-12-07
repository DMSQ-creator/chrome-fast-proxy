document.addEventListener('DOMContentLoaded', () => {
  const GFWLIST_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';
  
  const els = {
    host: document.getElementById('host'),
    port: document.getElementById('port'),
    scheme: document.getElementById('scheme'),
    ruleStatus: document.getElementById('ruleStatus'),
    statusSpan: document.getElementById('currentMode'),
    quickBox: document.getElementById('quickBox'),
    domainText: document.getElementById('domainText'),
    addDomainBtn: document.getElementById('addDomainBtn'),
    routingStatus: document.getElementById('routingStatus'),
    manualInput: document.getElementById('manualInput'),
    manualAddBtn: document.getElementById('manualAddBtn'),
    tagsList: document.getElementById('tagsList'),
    userCount: document.getElementById('userCount')
  };

  let currentDomain = "";
  let cachedUserRules = [];
  let cachedGfwDomains = [];
  let currentMode = "direct";

  chrome.storage.local.get(['host', 'port', 'scheme', 'ruleCount', 'lastUpdate', 'userRules', 'gfwDomains'], (items) => {
    if (items.host) els.host.value = items.host;
    if (items.port) els.port.value = items.port;
    if (items.scheme) els.scheme.value = items.scheme;
    cachedUserRules = items.userRules || [];
    cachedGfwDomains = items.gfwDomains || [];
    
    renderTags(); 
    updateRuleStatus(items.ruleCount, items.lastUpdate);
    checkCurrentMode(() => { detectCurrentTab(); });
  });

  // --- 路由状态检测 ---
  function checkRoutingLogic() {
    if (!currentDomain) return;
    let statusText = "", statusClass = "";

    if (currentMode === 'direct') {
        statusText = "⚪ 当前策略：直接连接 (全局直连)";
        statusClass = "status-direct";
    } else if (currentMode === 'fixed_servers') {
        statusText = "🟢 当前策略：代理连接 (全局代理)";
        statusClass = "status-proxy";
    } else if (currentMode === 'pac_script') {
        const inUser = cachedUserRules.includes(currentDomain);
        let inGfw = cachedGfwDomains.includes(currentDomain);
        if (!inGfw) {
            const parts = currentDomain.split('.');
            if (parts.length > 1) {
                const root = parts.slice(-2).join('.');
                if (cachedGfwDomains.includes(root)) inGfw = true;
            }
        }
        if (inUser || inGfw) {
            statusText = `🟢 当前策略：代理连接 (命中规则)`;
            statusClass = "status-proxy";
        } else {
            statusText = "⚪ 当前策略：直接连接 (未命中规则)";
            statusClass = "status-direct";
        }
    }
    els.routingStatus.textContent = statusText;
    els.routingStatus.className = `routing-badge ${statusClass}`;
  }

  // --- 标签与规则操作 ---
  function renderTags() {
    els.tagsList.innerHTML = "";
    els.userCount.textContent = cachedUserRules.length;
    if (cachedUserRules.length === 0) {
      els.tagsList.innerHTML = '<div class="empty-tip">暂无自定义规则</div>';
      return;
    }
    [...cachedUserRules].reverse().forEach(domain => {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.innerHTML = `<span>${domain}</span><span class="tag-close">×</span>`;
      tag.querySelector('.tag-close').addEventListener('click', () => removeDomain(domain));
      els.tagsList.appendChild(tag);
    });
  }

  function addDomain(domain) {
    if (!domain) return;
    domain = domain.trim();
    try { if (domain.includes('://')) domain = new URL(domain).hostname; } catch(e) {}
    if (cachedUserRules.includes(domain)) return;
    cachedUserRules.push(domain);
    saveUserRules();
  }

  function removeDomain(domain) {
    cachedUserRules = cachedUserRules.filter(d => d !== domain);
    saveUserRules();
  }

  function saveUserRules() {
    chrome.storage.local.set({ userRules: cachedUserRules }, () => {
      renderTags();
      updateQuickAddButtonState();
      checkRoutingLogic(); 
      chrome.proxy.settings.get({}, (d) => { if (d.value.mode === 'pac_script') applyAutoMode(); });
    });
  }

  els.manualAddBtn.addEventListener('click', () => {
    const val = els.manualInput.value;
    if (val) { addDomain(val); els.manualInput.value = ""; }
  });
  els.manualInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = els.manualInput.value;
        if (val) { addDomain(val); els.manualInput.value = ""; }
    }
  });

  function detectCurrentTab() {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      if (!tab.url || !tab.url.startsWith('http')) {
          els.quickBox.style.display = 'none';
          return;
      }
      try {
        const url = new URL(tab.url);
        let hostname = url.hostname;
        if (hostname.startsWith('www.')) hostname = hostname.substring(4);
        currentDomain = hostname;
        els.domainText.textContent = hostname;
        els.quickBox.style.display = 'block';
        updateQuickAddButtonState();
        checkRoutingLogic(); 
      } catch (e) {}
    });
  }

  function updateQuickAddButtonState() {
    if (cachedUserRules.includes(currentDomain)) {
      els.addDomainBtn.textContent = "🗑️ 从列表移除";
      els.addDomainBtn.className = "btn-remove";
      els.addDomainBtn.onclick = () => removeDomain(currentDomain);
    } else {
      els.addDomainBtn.textContent = "➕ 添加到列表";
      els.addDomainBtn.className = "btn-add";
      els.addDomainBtn.onclick = () => addDomain(currentDomain);
    }
  }

  function saveSettings() {
    chrome.storage.local.set({
      host: els.host.value,
      port: parseInt(els.port.value),
      scheme: els.scheme.value
    });
  }

  document.getElementById('updateBtn').addEventListener('click', async () => {
    const btn = document.getElementById('updateBtn');
    saveSettings();
    btn.textContent = "⏳ 下载中...";
    btn.disabled = true;
    try {
      const response = await fetch(GFWLIST_URL);
      if (!response.ok) throw new Error("Fail");
      const text = await response.text();
      const decoded = atob(text.replace(/\s/g, ''));
      const domains = parseGFWListToDomains(decoded);
      const now = new Date().toLocaleString();
      cachedGfwDomains = domains;
      chrome.storage.local.set({ gfwDomains: domains, ruleCount: domains.length, lastUpdate: now }, () => {
        updateRuleStatus(domains.length, now);
        btn.textContent = "✅ 成功";
        setTimeout(() => { btn.textContent = "🔄 更新 GFWList"; btn.disabled = false; }, 2000);
        chrome.proxy.settings.get({}, (d) => { if (d.value.mode === 'pac_script') applyAutoMode(); });
      });
    } catch (err) {
      alert("更新失败，请检查网络或开启全局代理。");
      btn.textContent = "❌ 失败";
      btn.disabled = false;
    }
  });

  document.getElementById('autoBtn').addEventListener('click', () => { saveSettings(); applyAutoMode(); });
  document.getElementById('proxyBtn').addEventListener('click', () => { saveSettings(); applyGlobalProxy(); });
  document.getElementById('directBtn').addEventListener('click', () => { setSimpleMode('direct'); });

  function applyAutoMode() {
    chrome.storage.local.get(['host', 'port', 'scheme', 'gfwDomains', 'userRules'], (items) => {
      const gfw = items.gfwDomains || [];
      const user = items.userRules || [];
      if (gfw.length === 0 && user.length === 0) { alert("请先添加规则！"); return; }
      const allDomains = [...new Set([...user, ...gfw])];
      const host = items.host || '127.0.0.1';
      const port = items.port || 7890;
      let scheme = items.scheme || 'SOCKS5';
      let proxyType = (scheme.toUpperCase() === 'HTTP') ? "PROXY" : "SOCKS5";
      const proxyStr = `${proxyType} ${host}:${port}; SOCKS ${host}:${port}; DIRECT`;
      
      const pacScriptStr = `
        var proxy = "${proxyStr}";
        var domainList = ${JSON.stringify(allDomains)};
        var domainMap = {};
        for (var i = 0; i < domainList.length; i++) { domainMap[domainList[i]] = 1; }
        function FindProxyForURL(url, host) {
          if (domainMap.hasOwnProperty(host)) return proxy;
          var pos = host.indexOf('.');
          while (pos !== -1) {
            var suffix = host.substring(pos + 1);
            if (domainMap.hasOwnProperty(suffix)) return proxy;
            pos = host.indexOf('.', pos + 1);
          }
          return "DIRECT";
        }
      `;
      chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScriptStr } }, scope: 'regular' }, () => checkCurrentMode());
    });
  }

  function parseGFWListToDomains(content) {
    const lines = content.split(/\r?\n/);
    const domainSet = new Set();
    const asciiRegex = /^[\w\-\.]+$/;
    lines.forEach(line => {
      if (!line || line.startsWith('!') || line.startsWith('[')) return;
      let d = line;
      if (d.startsWith('||')) d = d.substring(2);
      else if (d.startsWith('|')) return;
      d = d.replace(/^https?:\/\//, '');
      const slash = d.indexOf('/');
      if (slash > 0) d = d.substring(0, slash);
      if (d.includes('*') || (d.startsWith('/') && d.endsWith('/'))) return;
      if (d.includes('.') && !d.includes('%') && asciiRegex.test(d)) domainSet.add(d);
    });
    ['google.com', 'youtube.com', 'github.com', 'openai.com'].forEach(d => domainSet.add(d));
    return Array.from(domainSet);
  }

  function applyGlobalProxy() {
    chrome.storage.local.get(['host', 'port', 'scheme'], (items) => {
        const scheme = items.scheme ? items.scheme.toLowerCase() : 'socks5';
        const config = { mode: "fixed_servers", rules: { singleProxy: { scheme: scheme, host: items.host||'127.0.0.1', port: parseInt(items.port||7890) }, bypassList: ["<local>"] } };
        chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => checkCurrentMode());
    });
  }

  function setSimpleMode(mode) {
    chrome.proxy.settings.set({ value: { mode: mode }, scope: 'regular' }, () => checkCurrentMode());
  }

  function checkCurrentMode(callback) {
    chrome.proxy.settings.get({}, (details) => {
      if (chrome.runtime.lastError) return;
      const mode = details.value.mode;
      currentMode = mode;
      const map = { 'pac_script': '🤖 自动分流', 'fixed_servers': '🔵 全局代理', 'direct': '⚪ 直连' };
      els.statusSpan.textContent = map[mode] || mode;
      // 这里删除了 updateExtensionIcon，因为移交给 background 了
      if (callback) callback();
    });
  }
  
  function updateRuleStatus(count, time) {
    if (count) {
      els.ruleStatus.textContent = `✅ GFW缓存: ${count} 条`;
      els.ruleStatus.style.color = 'green';
    } else {
      els.ruleStatus.textContent = `⚠️ GFW未加载`;
      els.ruleStatus.style.color = '#d32f2f';
    }
  }
});