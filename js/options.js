const DEFAULT_GFWLIST_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';
// 用于延迟测试的目标 URL (Google 的 204 接口响应最快且无内容)
const LATENCY_TEST_URL = 'https://www.google.com/generate_204';

const els = {
  host: document.getElementById('host'),
  port: document.getElementById('port'),
  scheme: document.getElementById('scheme'),
  saveServerBtn: document.getElementById('saveServerBtn'),
  
  // Latency Test (New)
  testLatencyBtn: document.getElementById('testLatencyBtn'),
  latencyResult: document.getElementById('latencyResult'),
  
  // GFWList
  updateGfwBtn: document.getElementById('updateGfwBtn'),
  gfwStatus: document.getElementById('gfwStatus'),
  gfwUrlInput: document.getElementById('gfwUrlInput'),
  resetUrlBtn: document.getElementById('resetUrlBtn'),

  // Proxy Rules
  manualInput: document.getElementById('manualInput'),
  addRuleBtn: document.getElementById('addRuleBtn'),
  tagsList: document.getElementById('tagsList'),
  userCount: document.getElementById('userCount'),

  // Whitelist
  whitelistInput: document.getElementById('whitelistInput'),
  addWhitelistBtn: document.getElementById('addWhitelistBtn'),
  whitelistTags: document.getElementById('whitelistTags'),
  whitelistCount: document.getElementById('whitelistCount'),

  // Import/Export
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),

  toast: document.getElementById('toast')
};

let cachedUserRules = [];
let cachedUserWhitelist = [];
let cachedGfwDomains = [];

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(
    ['host', 'port', 'scheme', 'ruleCount', 'lastUpdate', 'userRules', 'userWhitelist', 'gfwDomains', 'gfwlistUrl'], 
    (items) => {
      // 基础设置
      els.host.value = items.host || "127.0.0.1";
      els.port.value = items.port || "7890";
      els.scheme.value = items.scheme || "SOCKS5";
      
      // URL 设置
      els.gfwUrlInput.value = items.gfwlistUrl || DEFAULT_GFWLIST_URL;
      
      // 数据缓存
      cachedUserRules = items.userRules || [];
      cachedUserWhitelist = items.userWhitelist || [];
      cachedGfwDomains = items.gfwDomains || [];
      
      // 渲染界面
      updateGfwUI(items.ruleCount, items.lastUpdate);
      renderProxyTags();
      renderWhitelistTags();
    }
  );
});

// --- 1. 服务器配置 & 延迟测试 ---
els.saveServerBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    host: els.host.value,
    port: parseInt(els.port.value),
    scheme: els.scheme.value
  }, () => {
    showToast("服务器配置已保存");
    applyChanges();
  });
});

// 新增：延迟测试逻辑
els.testLatencyBtn.addEventListener('click', async () => {
  els.latencyResult.innerHTML = "测试中...";
  els.latencyResult.style.color = "#666";
  els.testLatencyBtn.disabled = true;

  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

  try {
    // 请求 Google 204 接口，不产生流量，仅测试连通性
    await fetch(LATENCY_TEST_URL, {
      mode: 'no-cors', 
      cache: 'no-cache',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const ms = Date.now() - start;
    
    let color = "#4CAF50"; // Green
    if (ms > 500) color = "#FF9800"; // Orange
    if (ms > 1500) color = "#F44336"; // Red
    
    els.latencyResult.innerHTML = `<span style="color:${color}">${ms} ms</span>`;
    
  } catch (error) {
    els.latencyResult.innerHTML = `<span style="color:red">连接失败</span>`;
    console.error("Latency test failed:", error);
  } finally {
    els.testLatencyBtn.disabled = false;
  }
});

// --- 2. GFWList 更新 ---
els.resetUrlBtn.addEventListener('click', () => {
  els.gfwUrlInput.value = DEFAULT_GFWLIST_URL;
  showToast("已恢复默认地址，请点击更新");
});

els.updateGfwBtn.addEventListener('click', async () => {
  const targetUrl = els.gfwUrlInput.value.trim() || DEFAULT_GFWLIST_URL;
  els.updateGfwBtn.textContent = "⏳ 下载中...";
  els.updateGfwBtn.disabled = true;

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) throw new Error("下载失败");
    const text = await response.text();
    const decoded = atob(text.replace(/\s/g, ''));
    const domains = parseGFWListToDomains(decoded);
    const now = new Date().toLocaleString();
    
    cachedGfwDomains = domains;
    
    chrome.storage.local.set({ 
      gfwDomains: domains, 
      ruleCount: domains.length, 
      lastUpdate: now,
      gfwlistUrl: targetUrl 
    }, () => {
      updateGfwUI(domains.length, now);
      showToast(`成功更新 ${domains.length} 条规则`);
      applyChanges();
      els.updateGfwBtn.textContent = "🔄 立即更新";
      els.updateGfwBtn.disabled = false;
    });
  } catch (err) {
    console.error(err);
    alert("更新失败！请检查 URL 或网络连接。");
    els.updateGfwBtn.textContent = "❌ 失败";
    els.updateGfwBtn.disabled = false;
  }
});

// --- 3. 黑名单 (强制代理) 管理 ---
function renderProxyTags() {
  els.tagsList.innerHTML = "";
  els.userCount.textContent = cachedUserRules.length;
  [...cachedUserRules].reverse().forEach(domain => {
    const tag = createTag(domain, false, () => {
      cachedUserRules = cachedUserRules.filter(d => d !== domain);
      saveRules();
    });
    els.tagsList.appendChild(tag);
  });
}

els.addRuleBtn.addEventListener('click', () => {
  addDomain(els.manualInput, cachedUserRules, () => {
    if (cachedUserWhitelist.includes(els.manualInput.value.trim())) {
      if(!confirm("该域名已在[白名单]中，是否移动到[强制代理]？")) return false;
      cachedUserWhitelist = cachedUserWhitelist.filter(d => d !== els.manualInput.value.trim());
    }
    return true;
  }, saveRules);
});
els.manualInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') els.addRuleBtn.click(); });

// --- 4. 白名单 (强制直连) 管理 ---
function renderWhitelistTags() {
  els.whitelistTags.innerHTML = "";
  els.whitelistCount.textContent = cachedUserWhitelist.length;
  [...cachedUserWhitelist].reverse().forEach(domain => {
    const tag = createTag(domain, true, () => {
      cachedUserWhitelist = cachedUserWhitelist.filter(d => d !== domain);
      saveRules();
    });
    els.whitelistTags.appendChild(tag);
  });
}

els.addWhitelistBtn.addEventListener('click', () => {
  addDomain(els.whitelistInput, cachedUserWhitelist, () => {
    if (cachedUserRules.includes(els.whitelistInput.value.trim())) {
      if(!confirm("该域名已在[黑名单]中，是否移动到[强制直连]？")) return false;
      cachedUserRules = cachedUserRules.filter(d => d !== els.whitelistInput.value.trim());
    }
    return true;
  }, saveRules);
});
els.whitelistInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') els.addWhitelistBtn.click(); });

// --- 通用辅助函数 ---
function createTag(text, isDirect, onRemove) {
  const div = document.createElement('div');
  div.className = isDirect ? 'tag direct' : 'tag';
  div.innerHTML = `<span>${text}</span> <i>×</i>`;
  div.querySelector('i').addEventListener('click', onRemove);
  return div;
}

function addDomain(inputEl, list, preCheck, saveCb) {
  let val = inputEl.value.trim();
  if (!val) return;
  try { if (val.includes('://')) val = new URL(val).hostname; } catch(e){}
  
  if (list.includes(val)) {
    showToast("规则已存在");
    return;
  }
  if (preCheck && !preCheck()) return;

  list.push(val);
  inputEl.value = "";
  saveCb();
}

function saveRules() {
  chrome.storage.local.set({ 
    userRules: cachedUserRules,
    userWhitelist: cachedUserWhitelist
  }, () => {
    renderProxyTags();
    renderWhitelistTags();
    applyChanges();
  });
}

// --- 5. 导入/导出配置 ---
els.exportBtn.addEventListener('click', () => {
  chrome.storage.local.get(null, (items) => {
    const exportData = {
      timestamp: Date.now(),
      version: "5.3.0",
      config: {
        host: items.host,
        port: items.port,
        scheme: items.scheme,
        gfwlistUrl: items.gfwlistUrl,
        userRules: items.userRules || [],
        userWhitelist: items.userWhitelist || []
      }
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fastproxy_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    showToast("配置已导出");
  });
});

els.importBtn.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.config) {
        const c = data.config;
        const updates = {};
        if (c.host) updates.host = c.host;
        if (c.port) updates.port = c.port;
        if (c.scheme) updates.scheme = c.scheme;
        if (c.gfwlistUrl) updates.gfwlistUrl = c.gfwlistUrl;
        if (c.userRules) updates.userRules = c.userRules;
        if (c.userWhitelist) updates.userWhitelist = c.userWhitelist;
        
        chrome.storage.local.set(updates, () => {
          alert("导入成功！页面将刷新以加载新配置。");
          location.reload();
        });
      } else {
        alert("无效的配置文件格式");
      }
    } catch (err) {
      alert("文件解析失败: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = ''; 
});

// --- 核心：生成 PAC ---
function applyChanges() {
  chrome.storage.local.get(['host', 'port', 'scheme'], (items) => {
    const host = items.host || '127.0.0.1';
    const port = items.port || 7890;
    const scheme = items.scheme || 'SOCKS5';
    
    const proxyDomains = [...new Set([...cachedUserRules, ...cachedGfwDomains])];
    const directDomains = [...new Set(cachedUserWhitelist)];

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
    
    chrome.proxy.settings.get({}, (details) => {
      if (details.value.mode === 'pac_script') {
        chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScriptStr } }, scope: 'regular' });
      }
    });
  });
}

function updateGfwUI(count, time) {
  if (count) els.gfwStatus.innerHTML = `<span style="color:green">✅ 已缓存 ${count} 条 (更新于 ${time})</span>`;
  else els.gfwStatus.innerHTML = `<span style="color:red">⚠️ 未加载</span>`;
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

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.className = "show";
  setTimeout(() => { els.toast.className = els.toast.className.replace("show", ""); }, 3000);
}