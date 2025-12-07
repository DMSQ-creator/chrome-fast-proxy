document.addEventListener('DOMContentLoaded', () => {
  const GFWLIST_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';
  
  const els = {
    host: document.getElementById('host'),
    port: document.getElementById('port'),
    scheme: document.getElementById('scheme'),
    ruleStatus: document.getElementById('ruleStatus'),
    statusSpan: document.getElementById('currentMode')
  };

  // 初始化加载
  chrome.storage.local.get(['host', 'port', 'scheme', 'ruleCount', 'lastUpdate'], (items) => {
    if (items.host) els.host.value = items.host;
    if (items.port) els.port.value = items.port;
    if (items.scheme) els.scheme.value = items.scheme;
    updateRuleStatus(items.ruleCount, items.lastUpdate);
    
    // 检查状态并刷新图标
    checkCurrentMode();
  });

  // --- 按钮事件 ---
  
  document.getElementById('updateBtn').addEventListener('click', async () => {
    const btn = document.getElementById('updateBtn');
    saveSettings();

    btn.textContent = "⏳ 下载中...";
    btn.disabled = true;

    try {
      const response = await fetch(GFWLIST_URL);
      if (!response.ok) throw new Error("Download failed");
      const text = await response.text();
      const decoded = atob(text.replace(/\s/g, ''));
      const domains = parseGFWListToDomains(decoded);
      const now = new Date().toLocaleString();
      
      chrome.storage.local.set({ 
        gfwDomains: domains, 
        ruleCount: domains.length,
        lastUpdate: now 
      }, () => {
        updateRuleStatus(domains.length, now);
        btn.textContent = "✅ 更新成功";
        setTimeout(() => { 
          btn.textContent = "🔄 更新 GFWList 到本地"; 
          btn.disabled = false;
        }, 2000);
        
        // 刷新 PAC
        chrome.proxy.settings.get({}, (details) => {
          if (details.value.mode === 'pac_script') applyAutoMode();
        });
      });

    } catch (err) {
      alert("更新失败！请确保已开启‘全局代理’以便访问 GitHub。");
      btn.textContent = "❌ 失败";
      btn.disabled = false;
    }
  });

  document.getElementById('autoBtn').addEventListener('click', () => { saveSettings(); applyAutoMode(); });
  document.getElementById('proxyBtn').addEventListener('click', () => { saveSettings(); applyGlobalProxy(); });
  document.getElementById('directBtn').addEventListener('click', () => { setSimpleMode('direct'); });

  // --- 逻辑函数 ---

  function saveSettings() {
    chrome.storage.local.set({
      host: els.host.value,
      port: parseInt(els.port.value),
      scheme: els.scheme.value
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
      const slashIndex = d.indexOf('/');
      if (slashIndex > 0) d = d.substring(0, slashIndex);
      if (d.includes('*')) return; 
      if (d.startsWith('/') && d.endsWith('/')) return;
      if (d.includes('.') && !d.includes('%') && asciiRegex.test(d)) {
        domainSet.add(d);
      }
    });
    ['google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'githubusercontent.com', 'openai.com', 'instagram.com'].forEach(d => domainSet.add(d));
    return Array.from(domainSet);
  }

  function applyAutoMode() {
    chrome.storage.local.get(['host', 'port', 'scheme', 'gfwDomains'], (items) => {
      if (!items.gfwDomains || items.gfwDomains.length === 0) {
        alert("请先点击更新下载规则！");
        return;
      }
      const host = items.host || '127.0.0.1';
      const port = items.port || 7890;
      let scheme = items.scheme || 'SOCKS5';
      let proxyType = (scheme.toUpperCase() === 'HTTP') ? "PROXY" : "SOCKS5";
      
      const proxyStr = `${proxyType} ${host}:${port}; SOCKS ${host}:${port}; DIRECT`;
      const domainsJson = JSON.stringify(items.gfwDomains);
      
      const pacScriptStr = `
        var proxy = "${proxyStr}";
        var domainList = ${domainsJson};
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

      chrome.proxy.settings.set({
        value: { mode: "pac_script", pacScript: { data: pacScriptStr } },
        scope: 'regular'
      }, () => checkCurrentMode());
    });
  }

  function applyGlobalProxy() {
    chrome.storage.local.get(['host', 'port', 'scheme'], (items) => {
      const rawScheme = items.scheme || 'socks5';
      const config = {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: rawScheme.toLowerCase(),
            host: items.host || '127.0.0.1',
            port: parseInt(items.port || 7890)
          },
          bypassList: ["<local>"]
        }
      };
      chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => checkCurrentMode());
    });
  }

  function setSimpleMode(mode) {
    chrome.proxy.settings.set({ value: { mode: mode }, scope: 'regular' }, () => checkCurrentMode());
  }

  function checkCurrentMode() {
    chrome.proxy.settings.get({}, (details) => {
      if (chrome.runtime.lastError) return;
      const mode = details.value.mode;
      
      const map = { 'pac_script': '🤖 自动分流', 'fixed_servers': '🔵 全局代理', 'direct': '⚪ 直连' };
      els.statusSpan.textContent = map[mode] || mode;

      updateExtensionIcon(mode);
    });
  }

  // --- 【重写】Canvas 动态绘图图标 ---
  function updateExtensionIcon(mode) {
    // 1. 先清除掉之前的角标文字 (以防万一)
    chrome.action.setBadgeText({ text: "" });

    // 2. 定义颜色和字母
    let color = "#999";
    let char = "?";

    if (mode === 'pac_script') {
      color = "#673AB7"; // 紫色
      char = "A";        // Auto
    } else if (mode === 'fixed_servers') {
      color = "#4CAF50"; // 绿色
      char = "P";        // Proxy
    } else if (mode === 'direct') {
      color = "#2196F3"; // 蓝色
      char = "D";        // Direct
    }

    // 3. 使用 Canvas 画图
    const canvas = document.createElement('canvas');
    const size = 32; // 画布大小 (Retina屏更清晰)
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 画背景圆
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
    ctx.fill();

    // 画中间的字母
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif"; // 字体大小
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char, size/2, size/2 + 1); // +1 是为了视觉垂直居中

    // 4. 设置为扩展图标
    const imageData = ctx.getImageData(0, 0, size, size);
    chrome.action.setIcon({ imageData: imageData });
  }

  function updateRuleStatus(count, time) {
    if (count) {
      els.ruleStatus.textContent = `✅ 规则缓存: ${count} 条`;
      els.ruleStatus.style.color = 'green';
    } else {
      els.ruleStatus.textContent = `⚠️ 暂无规则`;
      els.ruleStatus.style.color = '#d32f2f';
    }
  }
});