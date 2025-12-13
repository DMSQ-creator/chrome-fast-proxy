// js/popup.js - v7.3.4 (Stable Layout)

const els = {
  serverSelect: document.getElementById('serverSelect'),
  domain: document.getElementById('currentDomain'),
  status: document.getElementById('routingStatus'),
  statusIcon: document.getElementById('statusIcon'),
  domainArea: document.getElementById('domainArea'),
  
  modePac: document.getElementById('mode-pac'),
  modeFixed: document.getElementById('mode-fixed'),
  modeDirect: document.getElementById('mode-direct'),
  
  addRuleBtn: document.getElementById('addRuleBtn'),
  removeBtn: document.getElementById('removeBtn'),
  
  goOptions: document.getElementById('openSettings')
};

let currentTabDomain = '';
let currentMode = 'direct';

// 1. 立即加载配置 (优先应用主题)
loadBaseConfig();

// 2. 并行分析标签页
analyzeCurrentTab();

// 3. 监听变化 (实时同步)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    loadBaseConfig(); 
    if (currentTabDomain) checkDomainStatusWrapper();
  }
});

function loadBaseConfig() {
  chrome.storage.local.get(null, (items) => {
    // 强制应用主题
    const theme = items.theme || 'system';
    const doc = document.documentElement;
    if (theme === 'dark') doc.setAttribute('data-theme', 'dark');
    else if (theme === 'light') doc.setAttribute('data-theme', 'light');
    else doc.removeAttribute('data-theme');

    // 渲染服务器
    const servers = items.serverList || [];
    const activeId = items.activeServerId;
    
    // Diff 逻辑防止重绘闪烁
    const currentOptions = Array.from(els.serverSelect.options).map(o => o.value + o.text).join('|');
    const newOptions = servers.map(s => s.id + s.name).join('|');
    
    if (currentOptions !== newOptions || els.serverSelect.innerHTML === '') {
      els.serverSelect.innerHTML = '';
      if (servers.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = "无服务器";
        els.serverSelect.appendChild(opt);
        els.serverSelect.disabled = true;
      } else {
        els.serverSelect.disabled = false;
        servers.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          if (s.id === activeId) opt.selected = true;
          els.serverSelect.appendChild(opt);
        });
      }
    } else {
      els.serverSelect.value = activeId;
    }

    // 更新模式 UI
    chrome.proxy.settings.get({}, (d) => {
      if (d && d.value) {
        currentMode = d.value.mode;
        updateModeUI(currentMode);
      }
    });
  });
}

function analyzeCurrentTab() {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.startsWith('http')) {
      try {
        const url = new URL(tab.url);
        currentTabDomain = url.hostname.toLowerCase();
        els.domain.textContent = currentTabDomain;
        els.domainArea.style.display = 'block';
        checkDomainStatusWrapper();
      } catch (e) { showInvalidPageUI(); }
    } else {
      showInvalidPageUI();
    }
  });
}

function checkDomainStatusWrapper() {
  if (!currentTabDomain) return;
  chrome.storage.local.get(null, (items) => {
    checkDomainStatus(items);
  });
}

function showInvalidPageUI() {
  els.domain.textContent = "当前页面无效";
  els.domainArea.style.display = 'block';
  els.status.textContent = "无法对此页面设置规则";
  els.statusIcon.textContent = "🚫";
  els.addRuleBtn.style.display = 'none';
  els.removeBtn.style.display = 'none';
}

function checkDomainStatus(items) {
  const userRules = items.userRules || [];
  const tempRules = items.tempRules || [];
  const whitelist = items.userWhitelist || [];
  const gfwRules = items.gfwDomains || [];
  
  let text = "未匹配 (直连)";
  let icon = "🛡️";
  let isProxy = false, isWhite = false;

  if (checkList(whitelist, currentTabDomain)) { 
    text = "强制直连 (白名单)"; 
    icon = "🛡️";
    isWhite = true; 
  } 
  else if (checkList(tempRules, currentTabDomain)) { 
    text = "临时代理"; 
    icon = "⏱️";
    isProxy = true; 
  }
  else if (checkList(userRules, currentTabDomain)) { 
    text = "强制代理 (黑名单)"; 
    icon = "🚀";
    isProxy = true; 
  }
  else if (checkList(gfwRules, currentTabDomain)) { 
    text = "匹配 GFWList (自动)"; 
    icon = "🌏";
  } 

  els.status.textContent = text;
  els.statusIcon.textContent = icon;
  
  if (isProxy || isWhite) {
    els.removeBtn.style.display = 'flex'; 
    els.addRuleBtn.style.display = 'none';
    els.removeBtn.onclick = () => removeDomainRule();
  } else {
    els.removeBtn.style.display = 'none'; 
    els.addRuleBtn.style.display = 'flex';
    els.addRuleBtn.onclick = () => addRule('userRules');
  }
}

function checkList(list, domain) {
  if (!list || list.length === 0) return false;
  const cleanDomain = domain.replace(/^www\./, '');
  for (let rule of list) {
    if (!rule) continue;
    if (rule.startsWith('*.')) rule = rule.substring(2);
    else if (rule.startsWith('.')) rule = rule.substring(1);
    if (domain === rule || cleanDomain === rule || domain.endsWith('.' + rule)) return true;
  }
  return false;
}

els.serverSelect.onchange = () => {
  const id = els.serverSelect.value;
  chrome.storage.local.set({ activeServerId: id }, () => {
    chrome.runtime.sendMessage({type: 'REFRESH_PROXY'});
  });
};

els.modePac.onclick = () => setMode('pac_script');
els.modeFixed.onclick = () => setMode('fixed_servers');
els.modeDirect.onclick = () => setMode('direct');

function setMode(mode) {
  const config = { mode: mode };
  if (mode === 'pac_script') {
    chrome.storage.local.get(['pacScriptData'], (i) => {
      if (i.pacScriptData) { 
        config.pacScript = { data: i.pacScriptData }; 
        applySetting(config, mode); 
      } else alert("PAC 未就绪，请先在设置页更新规则");
    });
  } else if (mode === 'fixed_servers') {
    chrome.storage.local.get(['serverList', 'activeServerId'], (i) => {
      const s = (i.serverList||[]).find(x => x.id === i.activeServerId);
      if (s) { 
        config.rules = { singleProxy: { scheme: s.scheme.toLowerCase(), host: s.host, port: parseInt(s.port || 80) } }; 
        applySetting(config, mode); 
      } else { alert("请先添加服务器"); chrome.runtime.openOptionsPage(); }
    });
  } else applySetting(config, mode);
}

function applySetting(c, m) { 
  chrome.proxy.settings.set({ value: c, scope: 'regular' }, () => { 
    currentMode = m; 
    updateModeUI(m); 
  }); 
}

function updateModeUI(m) {
  [els.modePac, els.modeFixed, els.modeDirect].forEach(e => e.classList.remove('active'));
  if (m === 'pac_script') els.modePac.classList.add('active');
  else if (m === 'fixed_servers') els.modeFixed.classList.add('active');
  else if (m === 'direct') els.modeDirect.classList.add('active');
}

function getRootDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (last.length === 2 && ['com','co','net','org','edu','gov'].includes(secondLast)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function addRule(key) {
  const root = getRootDomain(currentTabDomain);
  chrome.storage.local.get([key], (i) => {
    const list = i[key] || []; 
    if (!list.includes(root)) list.push(root);
    chrome.storage.local.set({ [key]: list });
  });
}

function removeDomainRule() {
  chrome.storage.local.get(['userRules', 'tempRules', 'userWhitelist'], (i) => {
    const root = getRootDomain(currentTabDomain);
    const filterFn = d => d !== currentTabDomain && d !== root && d !== currentTabDomain.replace(/^www\./, '');
    chrome.storage.local.set({
      tempRules: (i.tempRules||[]).filter(filterFn),
      userWhitelist: (i.userWhitelist||[]).filter(filterFn),
      userRules: (i.userRules||[]).filter(filterFn)
    });
  });
}

els.goOptions.onclick = () => chrome.runtime.openOptionsPage();