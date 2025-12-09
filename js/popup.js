document.addEventListener('DOMContentLoaded', () => {
  const els = {
    currentDomain: document.getElementById('currentDomain'),
    routingStatus: document.getElementById('routingStatus'),
    actionBtn: document.getElementById('actionBtn'),
    domainArea: document.getElementById('domainArea'),
    btnAuto: document.getElementById('btnAuto'),
    btnProxy: document.getElementById('btnProxy'),
    btnDirect: document.getElementById('btnDirect'),
    openSettings: document.getElementById('openSettings')
  };

  let currentDomainStr = "";
  let cachedUserRules = [];
  let cachedGfwDomains = [];
  let currentMode = "";

  // 1. 初始化数据
  chrome.storage.local.get(['userRules', 'gfwDomains'], (items) => {
    cachedUserRules = items.userRules || [];
    cachedGfwDomains = items.gfwDomains || [];
    initUI();
  });

  // 2. 打开设置页 (修复版)
  els.openSettings.addEventListener('click', () => {
    // 尝试使用 Chrome 标准 API 打开
    // 如果 manifest 没配置好或者报错，catch 会捕获错误并执行备用方案
    chrome.runtime.openOptionsPage().catch((err) => {
      console.error("无法通过 API 打开设置页，尝试直接跳转", err);
    // 注意：路径要写相对于根目录的完整路径
    window.open(chrome.runtime.getURL('html/options.html'));
    });
  });

  function initUI() {
    // 获取当前模式
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
    // 简单的模式切换，不需要重新生成 PAC，因为 PAC 内容没变
    let config = { mode: mode };
    
    if (mode === 'pac_script') {
        // 读取已有的 PAC 设置重新应用，防止丢失
        chrome.storage.local.get(['pacScriptData'], (items) => {
             if(items.pacScriptData) {
                 config.pacScript = { data: items.pacScriptData };
                 chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => initUI());
             } else {
                 // 如果还没有 PAC 数据，引导去设置页
                 alert("PAC 脚本未生成，请前往设置页面更新规则！");
                 chrome.runtime.openOptionsPage();
             }
        });
        return;
    } else if (mode === 'fixed_servers') {
        // 读取代理服务器设置
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
    // 移除所有 active
    [els.btnAuto, els.btnProxy, els.btnDirect].forEach(b => b.classList.remove('active'));
    // 添加 active
    if (mode === 'pac_script') els.btnAuto.classList.add('active');
    else if (mode === 'fixed_servers') els.btnProxy.classList.add('active');
    else if (mode === 'direct') els.btnDirect.classList.add('active');
  }

  // 4. 域名检测与快捷添加
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
        updateActionButton();

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
        // 简单检测 GFW
        let inGfw = cachedGfwDomains.includes(currentDomainStr);
        if(!inGfw) {
             const parts = currentDomainStr.split('.');
             if(parts.length > 1) {
                 if(cachedGfwDomains.includes(parts.slice(-2).join('.'))) inGfw = true;
             }
        }

        if (inUser || inGfw) {
            text = "自动: 走代理";
            cls = "status-proxy";
        } else {
            text = "自动: 直连";
        }
    }
    els.routingStatus.textContent = text;
    els.routingStatus.className = `status-badge ${cls}`;
  }

  function updateActionButton() {
    if (cachedUserRules.includes(currentDomainStr)) {
      els.actionBtn.textContent = "🗑️ 移除规则 (强制直连)";
      els.actionBtn.className = "btn-action btn-remove";
      els.actionBtn.onclick = () => {
        cachedUserRules = cachedUserRules.filter(d => d !== currentDomainStr);
        saveAndReload();
      };
    } else {
      els.actionBtn.textContent = "➕ 添加规则 (强制代理)";
      els.actionBtn.className = "btn-action btn-add";
      els.actionBtn.onclick = () => {
        cachedUserRules.push(currentDomainStr);
        saveAndReload();
      };
    }
  }

  function saveAndReload() {
    chrome.storage.local.set({ userRules: cachedUserRules }, () => {
      // 只需要保存，background.js 会更新图标，options.js (如果打开) 会更新列表
      // 但是我们需要重新应用 PAC，这里简单调用一次消息或者重新生成
      // 为了简单，我们发送一个信号给 Options 或者直接在这里重新计算 PAC 
      // 由于 popup 关闭后无法运行，我们在这里快速生成一次 PAC
      reapplyPac();
      updateActionButton();
      updateRoutingStatus();
    });
  }

  // 复用 PAC 生成逻辑 (这是必要的冗余，为了 Popup 操作立即生效)
  function reapplyPac() {
    chrome.storage.local.get(['host', 'port', 'scheme', 'gfwDomains'], (items) => {
        const gfw = items.gfwDomains || [];
        const user = cachedUserRules;
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
        // 保存 PAC 内容以便下次切换模式使用
        chrome.storage.local.set({ pacScriptData: pacScriptStr });
        
        // 如果当前是自动模式，立即应用
        if(currentMode === 'pac_script') {
            chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScriptStr } }, scope: 'regular' });
        }
    });
  }
});