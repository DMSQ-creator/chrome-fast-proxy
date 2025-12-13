// js/background.js - v7.3.4

let cachedUserRules = new Set();
let cachedUserWhitelist = new Set();
let cachedGfwDomains = new Set();
let cachedTempRules = new Set();
let isSyncing = false;
let uploadDebounceTimer = null;

const CONFIG_FILE_NAME = 'fastproxy_config.json';
const DAV_DIR_NAME = 'FastProxy';

// 初始化
chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === 'install') {
    const items = await chrome.storage.local.get(['serverList']);
    if (!items.serverList || items.serverList.length === 0) {
      const def = { id: crypto.randomUUID(), name: 'Default', scheme: 'SOCKS5', host: '127.0.0.1', port: 10808 };
      await chrome.storage.local.set({ serverList: [def], activeServerId: def.id });
    }
    chrome.runtime.openOptionsPage();
  }
  updateCacheAndApply();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    // 只要影响代理规则或服务器的变量变了，就重新应用
    if (changes.userRules || changes.userWhitelist || changes.gfwDomains || 
        changes.serverList || changes.activeServerId || changes.tempRules) {
      updateCacheAndApply();
      if (!isSyncing && (changes.userRules || changes.userWhitelist || changes.serverList)) {
        chrome.storage.local.get(['autoSync'], (s) => { if (s.autoSync) triggerAutoUpload(); });
      }
    }
  }
});

chrome.runtime.onMessage.addListener((m, s, sendResponse) => {
  if (m.type === 'REFRESH_PROXY') {
    updateCacheAndApply();
  } else if (m.type === 'MANUAL_SYNC_UPLOAD') {
    performCloudUpload().then(t => sendResponse({success:true, time:t})).catch(e => sendResponse({success:false, error:e.message}));
    return true; 
  } else if (m.type === 'MANUAL_SYNC_DOWNLOAD') {
    performCloudDownload().then(t => sendResponse({success:true, time:t})).catch(e => sendResponse({success:false, error:e.message}));
    return true; 
  }
});

function normalizeSet(list) {
  if (!list) return new Set();
  return new Set(list.map(d => {
    let domain = d.toLowerCase().trim();
    if (domain.startsWith('*.')) domain = domain.substring(2);
    else if (domain.startsWith('.')) domain = domain.substring(1);
    return domain;
  }).filter(Boolean));
}

function updateCacheAndApply() {
  chrome.storage.local.get(null, (items) => {
    cachedUserRules = normalizeSet(items.userRules);
    cachedUserWhitelist = normalizeSet(items.userWhitelist);
    cachedGfwDomains = normalizeSet(items.gfwDomains);
    cachedTempRules = normalizeSet(items.tempRules);
    updateIconForActiveTab();
    applyProxySettings(items);
  });
}

function applyProxySettings(items) {
  const servers = items.serverList || [];
  const activeServer = servers.find(s => s.id === items.activeServerId) || servers[0];
  
  if (!activeServer) {
    chrome.proxy.settings.set({ value: { mode: "direct" }, scope: 'regular' });
    return;
  }

  const { host, port, scheme } = activeServer;
  const proxyType = (scheme.toUpperCase() === 'HTTP') ? "PROXY" : "SOCKS5";
  const proxyStr = `${proxyType} ${host}:${port}; SOCKS ${host}:${port}; DIRECT`;

  const pacScriptStr = `
    var Proxy = "${proxyStr}";
    var Direct = "DIRECT";
    var pMap = ${JSON.stringify(Object.fromEntries([...cachedUserRules, ...cachedGfwDomains, ...cachedTempRules].map(d=>[d,1])))};
    var dMap = ${JSON.stringify(Object.fromEntries([...cachedUserWhitelist].map(d=>[d,1])))};
    function FindProxyForURL(url, host) {
      if (isPlainHostName(host) || shExpMatch(host, "*.local") || isInNet(host, "10.0.0.0", "255.0.0.0") || isInNet(host, "172.16.0.0", "255.240.0.0") || isInNet(host, "192.168.0.0", "255.255.0.0") || isInNet(host, "127.0.0.0", "255.0.0.0")) return Direct;
      host = host.toLowerCase();
      if (check(host, dMap)) return Direct;
      if (check(host, pMap)) return Proxy;
      return Direct;
    }
    function check(h, m) {
      if (m[h]) return true;
      var p = h.indexOf('.');
      while (p !== -1) {
        if (m[h.substring(p + 1)]) return true;
        p = h.indexOf('.', p + 1);
      }
      return false;
    }
  `;

  chrome.storage.local.set({ pacScriptData: pacScriptStr });
  chrome.proxy.settings.get({}, (d) => {
    const mode = (d && d.value) ? d.value.mode : 'direct';
    if (mode === 'pac_script') {
      chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScriptStr } }, scope: 'regular' });
    } else if (mode === 'fixed_servers') {
      chrome.proxy.settings.set({ value: { mode: "fixed_servers", rules: { singleProxy: { scheme: scheme.toLowerCase(), host, port: parseInt(port) } } }, scope: 'regular' });
    }
  });
}

// 同步核心 (含 WebDAV MKCOL 405 修复)
async function bgWebdavUpload(i,d){
  const a='Basic '+btoa(i.davUser+':'+i.davPass);
  const r=i.davUrl.endsWith('/')?i.davUrl:i.davUrl+'/';
  await fetch(r+DAV_DIR_NAME+'/',{method:'MKCOL',headers:{'Authorization':a}}); // 忽略 405
  const res = await fetch(r+DAV_DIR_NAME+'/'+CONFIG_FILE_NAME,{method:'PUT',headers:{'Authorization':a,'Content-Type':'application/json'},body:JSON.stringify(d)});
  if(!res.ok) throw new Error("Upload failed: " + res.status);
}

// 缓存刷新 (含 Gist Raw URL 缓存修复)
async function bgGithubDownload(t){
  const g=await ghFetch('https://api.github.com/gists','GET',t);
  const target=g.find(x=>x.files&&x.files[CONFIG_FILE_NAME]);
  if(!target) throw new Error("No config found");
  const r=await fetch(target.files[CONFIG_FILE_NAME].raw_url + '?t=' + Date.now());
  return await r.json();
}

async function performCloudUpload(){ /* ... 同前 ... */ }
async function performCloudDownload(){ /* ... 同前 ... */ }
function triggerAutoUpload(){if(uploadDebounceTimer)clearTimeout(uploadDebounceTimer);uploadDebounceTimer=setTimeout(()=>performCloudUpload(),10000)}
function ghFetch(u,m,t,b){ /* ... 同前 ... */ }

// 图标管理
function updateIconForActiveTab(){
  chrome.proxy.settings.get({}, d => {
    const mode = (d && d.value) ? d.value.mode : 'direct';
    chrome.tabs.query({active:true, currentWindow:true}, t => {
      if(t && t[0] && t[0].url) drawIcon(calculateState(t[0].url, mode));
    });
  });
}
function calculateState(u, m){
  if(m === 'fixed_servers') return {c:"#4CAF50", t:"P"};
  if(m === 'direct') return {c:"#2196F3", t:"D"};
  if(m === 'pac_script' && u.startsWith('http')){
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
      if(checkSet(h, cachedUserWhitelist)) return {c:"#2196F3", t:"W"};
      if(checkSet(h, cachedTempRules)) return {c:"#FF9800", t:"T"};
      if(checkSet(h, cachedUserRules) || checkSet(h, cachedGfwDomains)) return {c:"#4CAF50", t:"A"};
    } catch(e){}
  }
  return {c:"#9E9E9E", t:"A"};
}
function checkSet(h, s) { if(!s) return false; if(s.has(h)) return true; var p=h.indexOf('.'); while(p!==-1){ if(s.has(h.substring(p+1))) return true; p=h.indexOf('.',p+1); } return false; }
function drawIcon(s){
  const c = new OffscreenCanvas(32,32);
  const x = c.getContext('2d');
  x.fillStyle = s.c; x.beginPath(); x.arc(16,16,16,0,Math.PI*2); x.fill();
  x.fillStyle = "#fff"; x.font = "bold 20px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(s.t, 16, 17);
  chrome.action.setIcon({imageData: x.getImageData(0,0,32,32)});
}

chrome.tabs.onActivated.addListener(updateIconForActiveTab);
chrome.tabs.onUpdated.addListener(updateIconForActiveTab);