const GFWLIST_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';

const els = {
  host: document.getElementById('host'),
  port: document.getElementById('port'),
  scheme: document.getElementById('scheme'),
  saveServerBtn: document.getElementById('saveServerBtn'),
  updateGfwBtn: document.getElementById('updateGfwBtn'),
  gfwStatus: document.getElementById('gfwStatus'),
  manualInput: document.getElementById('manualInput'),
  addRuleBtn: document.getElementById('addRuleBtn'),
  tagsList: document.getElementById('tagsList'),
  userCount: document.getElementById('userCount'),
  toast: document.getElementById('toast')
};

let cachedUserRules = [];
let cachedGfwDomains = [];

// 初始化加载
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['host', 'port', 'scheme', 'ruleCount', 'lastUpdate', 'userRules', 'gfwDomains'], (items) => {
    if (items.host) els.host.value = items.host; else els.host.value = "127.0.0.1";
    if (items.port) els.port.value = items.port; else els.port.value = "7890";
    if (items.scheme) els.scheme.value = items.scheme;
    
    cachedUserRules = items.userRules || [];
    cachedGfwDomains = items.gfwDomains || [];
    
    updateGfwUI(items.ruleCount, items.lastUpdate);
    renderTags();
  });
});

// --- 1. 服务器配置 ---
els.saveServerBtn.addEventListener('click', () => {
  const config = {
    host: els.host.value,
    port: parseInt(els.port.value),
    scheme: els.scheme.value
  };
  chrome.storage.local.set(config, () => {
    showToast("服务器配置已保存");
    applyChanges(); // 重新生成 PAC
  });
});

// --- 2. GFWList 更新 ---
els.updateGfwBtn.addEventListener('click', async () => {
  els.updateGfwBtn.textContent = "⏳ 下载中...";
  els.updateGfwBtn.disabled = true;

  try {
    const response = await fetch(GFWLIST_URL);
    if (!response.ok) throw new Error("下载失败");
    const text = await response.text();
    const decoded = atob(text.replace(/\s/g, ''));
    const domains = parseGFWListToDomains(decoded);
    const now = new Date().toLocaleString();
    
    cachedGfwDomains = domains;
    
    chrome.storage.local.set({ gfwDomains: domains, ruleCount: domains.length, lastUpdate: now }, () => {
      updateGfwUI(domains.length, now);
      showToast(`成功更新 ${domains.length} 条规则`);
      applyChanges();
      
      els.updateGfwBtn.textContent = "🔄 立即更新";
      els.updateGfwBtn.disabled = false;
    });
  } catch (err) {
    alert("更新失败！请检查网络或确认代理已开启。");
    els.updateGfwBtn.textContent = "❌ 失败";
    els.updateGfwBtn.disabled = false;
  }
});

function updateGfwUI(count, time) {
  if (count) {
    els.gfwStatus.innerHTML = `<span style="color:green">✅ 已缓存 ${count} 条 (更新于 ${time})</span>`;
  } else {
    els.gfwStatus.innerHTML = `<span style="color:red">⚠️ 未加载</span>`;
  }
}

// --- 3. 自定义规则管理 ---
function renderTags() {
  els.tagsList.innerHTML = "";
  els.userCount.textContent = cachedUserRules.length;
  
  [...cachedUserRules].reverse().forEach(domain => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span>${domain}</span> <i>×</i>`;
    tag.querySelector('i').addEventListener('click', () => {
      cachedUserRules = cachedUserRules.filter(d => d !== domain);
      saveRules();
    });
    els.tagsList.appendChild(tag);
  });
}

function addRule() {
  const val = els.manualInput.value.trim();
  if (!val) return;
  // 简单去重和清洗
  let domain = val;
  try { if (domain.includes('://')) domain = new URL(domain).hostname; } catch(e){}
  
  if (!cachedUserRules.includes(domain)) {
    cachedUserRules.push(domain);
    saveRules();
    els.manualInput.value = "";
  } else {
    showToast("规则已存在");
  }
}

els.addRuleBtn.addEventListener('click', addRule);
els.manualInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addRule(); });

function saveRules() {
  chrome.storage.local.set({ userRules: cachedUserRules }, () => {
    renderTags();
    applyChanges();
  });
}

// --- 通用：应用变更 (生成 PAC) ---
function applyChanges() {
  // 读取最新的配置
  chrome.storage.local.get(['host', 'port', 'scheme'], (items) => {
    const host = items.host || '127.0.0.1';
    const port = items.port || 7890;
    const scheme = items.scheme || 'SOCKS5';
    
    // 合并规则
    const allDomains = [...new Set([...cachedUserRules, ...cachedGfwDomains])];
    
    // 生成脚本
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
    
    // 1. 保存 PAC 内容到 storage (供 popup 模式切换时读取)
    chrome.storage.local.set({ pacScriptData: pacScriptStr });
    
    // 2. 如果当前已经是自动模式，立即刷新浏览器代理设置
    chrome.proxy.settings.get({}, (details) => {
      if (details.value.mode === 'pac_script') {
        chrome.proxy.settings.set({
          value: { mode: "pac_script", pacScript: { data: pacScriptStr } },
          scope: 'regular'
        });
      }
      // 如果是全局代理，且修改了端口，也需要刷新
      else if (details.value.mode === 'fixed_servers') {
         const config = {
            mode: "fixed_servers",
            rules: {
                singleProxy: { scheme: scheme.toLowerCase(), host: host, port: parseInt(port) },
                bypassList: ["<local>"]
            }
         };
         chrome.proxy.settings.set({ value: config, scope: 'regular' });
      }
    });
  });
}

// 辅助：解析 GFWList
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