document.addEventListener('DOMContentLoaded', () => {
  const els = {
    currentDomain: document.getElementById('currentDomain'),
    routingStatus: document.getElementById('routingStatus'),
    actionArea: document.getElementById('actionArea'),
    domainArea: document.getElementById('domainArea'),
    btnAuto: document.getElementById('btnAuto'),
    btnProxy: document.getElementById('btnProxy'),
    btnDirect: document.getElementById('btnDirect'),
    openSettings: document.getElementById('openSettings')
  };

  let currentDomainStr = "";
  let cachedUserRules = [];
  let cachedUserWhitelist = []; // 新增
  let cachedGfwDomains = [];
  let currentMode = "";

  // 1. 初始化数据，增加 userWhitelist
  chrome.storage.local.get(['userRules', 'userWhitelist', 'gfwDomains'], (items) => {
    cachedUserRules = items.userRules || [];
    cachedUserWhitelist = items.userWhitelist || [];
    cachedGfwDomains = items.gfwDomains || [];
    initUI();
  });

  els.openSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage().catch(() => {
      window.open(chrome.runtime.getURL('html/options.html'));
    });
  });

  function initUI() {
    chrome.proxy.settings.get({}, (details) => {
      currentMode = details.value.mode;
      updateModeButtons(currentMode);
      detectCurrentTab();
    });
  }

  // 3. 模式切换
  els.btnAuto.addEventListener('click', () => setMode('pac_script'));
  els.btnProxy.addEventListener('click', () => setMode('fixed_servers'));
  els.btnDirect.addEventListener('click', () => setMode('direct'));

  function setMode(mode) {
    let config = { mode: mode };
    
    if (mode === 'pac_script') {
        chrome.storage.local.get(['pacScriptData'], (items) => {
             if(items.pacScriptData) {
                 config.pacScript = { data: items.pacScriptData };
                 chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => initUI());
             } else {
                 alert("请先到设置页面更新规则！");
                 chrome.runtime.openOptionsPage();
             }
        });
        return;
    } else if (mode === 'fixed_servers') {
        chrome.storage.local.get(['host', 'port', 'scheme'], (items) => {
            const scheme = items.scheme ? items.scheme.toLowerCase() : 'socks5';
            config.rules = {
                singleProxy: { scheme: scheme, host: items.host||'127.0.0.1', port: parseInt(items.port||7890) },
                bypassList: ["<local>"]
            };
            chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => initUI());
        });
        return;
    }

    chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => initUI());
  }

  function updateModeButtons(mode) {
    [els.btnAuto, els.btnProxy, els.btnDirect].forEach(b => b.classList.remove('active'));
    if (mode === 'pac_script') els.btnAuto.classList.add('active');
    else if (mode === 'fixed_servers') els.btnProxy.classList.add('active');
    else if (mode === 'direct') els.btnDirect.classList.add('active');
  }

  function detectCurrentTab() {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      if (!tab.url || !tab.url.startsWith('http')) return;

      try {
        const url = new URL(tab.url);
        let hostname = url.hostname;
        if (hostname.startsWith('www.')) hostname = hostname.substring(4);
        
        currentDomainStr = hostname;
        els.currentDomain.textContent = hostname;
        els.domainArea.style.display = 'block';

        updateRoutingStatus();
        renderActionButtons();

      } catch (e) {}
    });
  }

  function updateRoutingStatus() {
    let text = "未知";
    let cls = "status-direct";

    if (currentMode === 'direct') {
        text = "全局直连";
    } else if (currentMode === 'fixed_servers') {
        text = "全局代理";
        cls = "status-proxy";
    } else if (currentMode === 'pac_script') {
        const inUser = cachedUserRules.includes(currentDomainStr);
        const inWhite = cachedUserWhitelist.includes(currentDomainStr);
        
        // 简单检测 GFW (不包含后缀匹配，仅供 UI 显示)
        let inGfw = cachedGfwDomains.includes(currentDomainStr);
        if(!inGfw) {
             const parts = currentDomainStr.split('.');
             if(parts.length > 1) {
                 if(cachedGfwDomains.includes(parts.slice(-2).join('.'))) inGfw = true;
             }
        }

        if (inWhite) {
            text = "规则: 强制直连";
            cls = "status-direct";
        } else if (inUser) {
            text = "规则: 强制代理";
            cls = "status-proxy";
        } else if (inGfw) {
            text = "GFW: 自动代理";
            cls = "status-proxy";
        } else {
            text = "默认: 直连";
        }
    }
    els.routingStatus.textContent = text;
    els.routingStatus.className = `status-badge ${cls}`;
  }

  function renderActionButtons() {
    els.actionArea.innerHTML = "";
    
    // 1. 如果在黑名单中，显示移除代理
    if (cachedUserRules.includes(currentDomainStr)) {
      const btn = document.createElement('button');
      btn.className = "btn-action btn-remove";
      btn.textContent = "🗑️ 移除强制代理";
      btn.onclick = () => {
        cachedUserRules = cachedUserRules.filter(d => d !== currentDomainStr);
        saveAndReload();
      };
      els.actionArea.appendChild(btn);
      return;
    }

    // 2. 如果在白名单中，显示移除直连
    if (cachedUserWhitelist.includes(currentDomainStr)) {
      const btn = document.createElement('button');
      btn.className = "btn-action btn-remove";
      btn.textContent = "🗑️ 移除强制直连";
      btn.onclick = () => {
        cachedUserWhitelist = cachedUserWhitelist.filter(d => d !== currentDomainStr);
        saveAndReload();
      };
      els.actionArea.appendChild(btn);
      return;
    }

    // 3. 如果都不在，显示两个按钮
    const div = document.createElement('div');
    div.className = "action-group";

    const btnProxy = document.createElement('button');
    btnProxy.className = "btn-action btn-add-proxy";
    btnProxy.textContent = "➕ 走代理";
    btnProxy.onclick = () => {
      cachedUserRules.push(currentDomainStr);
      saveAndReload();
    };

    const btnDirect = document.createElement('button');
    btnDirect.className = "btn-action btn-add-direct";
    btnDirect.textContent = "🛡️ 走直连";
    btnDirect.onclick = () => {
      cachedUserWhitelist.push(currentDomainStr);
      saveAndReload();
    };

    div.appendChild(btnProxy);
    div.appendChild(btnDirect);
    els.actionArea.appendChild(div);
  }

  function saveAndReload() {
    chrome.storage.local.set({ 
      userRules: cachedUserRules,
      userWhitelist: cachedUserWhitelist
    }, () => {
      reapplyPac(); // 重新计算
      renderActionButtons();
      updateRoutingStatus();
    });
  }

  // 这里的 reapplyPac 需要和 options.js 中的逻辑保持一致
  function reapplyPac() {
    chrome.storage.local.get(['host', 'port', 'scheme', 'gfwDomains'], (items) => {
        const gfw = items.gfwDomains || [];
        // 黑名单
        const proxyDomains = [...new Set([...cachedUserRules, ...gfw])];
        // 白名单
        const directDomains = [...new Set(cachedUserWhitelist)];
        
        const host = items.host || '127.0.0.1';
        const port = items.port || 7890;
        let scheme = items.scheme || 'SOCKS5';
        let proxyType = (scheme.toUpperCase() === 'HTTP') ? "PROXY" : "SOCKS5";
        const proxyStr = `${proxyType} ${host}:${port}; SOCKS ${host}:${port}; DIRECT`;
        
        const pacScriptStr = `
          var proxy = "${proxyStr}";
          var direct = "DIRECT";
          var proxyDomains = ${JSON.stringify(proxyDomains)};
          var directDomains = ${JSON.stringify(directDomains)};
          var proxyMap = {};
          var directMap = {};
          for (var i = 0; i < proxyDomains.length; i++) { proxyMap[proxyDomains[i]] = 1; }
          for (var i = 0; i < directDomains.length; i++) { directMap[directDomains[i]] = 1; }
          function FindProxyForURL(url, host) {
            if (checkMap(host, directMap)) return direct;
            if (checkMap(host, proxyMap)) return proxy;
            return direct;
          }
          function checkMap(host, map) {
            if (map.hasOwnProperty(host)) return true;
            var pos = host.indexOf('.');
            while (pos !== -1) {
              var suffix = host.substring(pos + 1);
              if (map.hasOwnProperty(suffix)) return true;
              pos = host.indexOf('.', pos + 1);
            }
            return false;
          }
        `;
        
        chrome.storage.local.set({ pacScriptData: pacScriptStr });
        if(currentMode === 'pac_script') {
            chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScriptStr } }, scope: 'regular' });
        }
    });
  }
});