// background.js - v5.8.0

let cachedUserRules = new Set();
let cachedUserWhitelist = new Set();
let cachedGfwDomains = new Set();
let currentMode = 'direct';
let lastDrawState = { color: null, char: null };

let isSyncing = false;
let uploadDebounceTimer = null;

const CONFIG_FILE_NAME = 'fastproxy_config.json';
const DAV_DIR_NAME = 'FastProxy';

// 1. 初始化
chrome.storage.local.get(
  ['userRules', 'userWhitelist', 'gfwDomains', 'autoSync', 'syncInterval'], 
  (items) => {
    updateSets(items.userRules, items.userWhitelist, items.gfwDomains);
    if (items.autoSync) {
      // 默认每天 (1440分钟)
      setupAlarm(true, parseInt(items.syncInterval || 1440));
    }
  }
);

// 2. 浏览器启动时触发同步
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['autoSync'], (items) => {
    if (items.autoSync) {
      console.log("🚀 浏览器启动，触发自动下载...");
      performCloudDownload();
    }
  });
});

// 3. 监听数据变化 (自动上传)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.userRules || changes.userWhitelist || changes.gfwDomains) {
      chrome.storage.local.get(['userRules', 'userWhitelist', 'gfwDomains'], (items) => {
        updateSets(items.userRules, items.userWhitelist, items.gfwDomains);
        updateIconForActiveTab();
      });

      if (!isSyncing) {
        chrome.storage.local.get(['autoSync'], (s) => {
          if (s.autoSync) {
            triggerAutoUpload();
          }
        });
      }
    }
  }
});

// 4. 监听前端设置变更
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'UPDATE_ALARM') {
    chrome.storage.local.get(['syncInterval'], (items) => {
      setupAlarm(msg.enabled, parseInt(items.syncInterval || 1440));
    });
  }
});

// 5. 定时任务
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoCloudSync') {
    console.log("⏰ 定时任务触发，开始下载...");
    performCloudDownload();
  }
});

function setupAlarm(enabled, minutes) {
  chrome.alarms.clear('autoCloudSync', () => {
    if (enabled) {
      chrome.alarms.create('autoCloudSync', { periodInMinutes: minutes });
      console.log(`✅ 定时同步已启用: 每 ${minutes} 分钟`);
    }
  });
}

// --- 同步核心逻辑 ---

function triggerAutoUpload() {
  if (uploadDebounceTimer) clearTimeout(uploadDebounceTimer);
  console.log("⏳ 配置变更，10秒后自动上传...");
  uploadDebounceTimer = setTimeout(() => {
    console.log("☁️ 执行自动上传...");
    performCloudUpload();
  }, 10000); 
}

async function performCloudUpload() {
  try {
    const items = await chrome.storage.local.get(null);
    if (!items.syncProvider) return;

    const exportData = {
      timestamp: Date.now(),
      version: "5.8.0",
      fromAutoSync: true,
      config: {
        host: items.host,
        port: items.port,
        scheme: items.scheme,
        gfwlistUrl: items.gfwlistUrl,
        userRules: items.userRules || [],
        userWhitelist: items.userWhitelist || []
      }
    };

    if (items.syncProvider === 'github') {
      if (!items.gitToken) return;
      await bgGithubUpload(items.gitToken, exportData);
    } else if (items.syncProvider === 'webdav') {
      if (!items.davUrl) return;
      await bgWebdavUpload(items, exportData);
    }
    
    // ✅ 关键修改：更新上次同步时间
    const nowStr = new Date().toLocaleString();
    chrome.storage.local.set({ lastSyncTime: nowStr });
    console.log("✅ 自动上传成功:", nowStr);
    
  } catch (e) {
    console.error("❌ 自动上传失败:", e);
  }
}

async function performCloudDownload() {
  isSyncing = true; 
  try {
    const items = await chrome.storage.local.get(null);
    let config = null;

    if (items.syncProvider === 'github') {
      if (!items.gitToken) return;
      config = await bgGithubDownload(items.gitToken);
    } else if (items.syncProvider === 'webdav') {
      if (!items.davUrl) return;
      config = await bgWebdavDownload(items);
    }

    if (config && config.config) {
      const c = config.config;
      const updates = {};
      if (c.host) updates.host = c.host;
      if (c.port) updates.port = c.port;
      if (c.scheme) updates.scheme = c.scheme;
      if (c.userRules) updates.userRules = c.userRules;
      if (c.userWhitelist) updates.userWhitelist = c.userWhitelist;
      
      // ✅ 关键修改：更新上次同步时间
      const nowStr = new Date().toLocaleString();
      updates.lastSyncTime = nowStr;

      await chrome.storage.local.set(updates);
      console.log("✅ 自动下载成功:", nowStr);
    }
  } catch (e) {
    console.error("❌ 自动下载失败:", e);
  } finally {
    setTimeout(() => { isSyncing = false; }, 2000);
  }
}

// --- API Helpers (保持不变) ---
async function bgGithubUpload(token, data) {
  const gists = await githubFetch('https://api.github.com/gists', 'GET', token);
  const target = gists.find(g => g.files && g.files[CONFIG_FILE_NAME]);
  const body = {
    description: "FastProxy Sync Data (Auto)",
    public: false,
    files: { [CONFIG_FILE_NAME]: { content: JSON.stringify(data, null, 2) } }
  };
  if (target) await githubFetch(`https://api.github.com/gists/${target.id}`, 'PATCH', token, body);
  else await githubFetch(`https://api.github.com/gists`, 'POST', token, body);
}

async function bgGithubDownload(token) {
  const gists = await githubFetch('https://api.github.com/gists', 'GET', token);
  const target = gists.find(g => g.files && g.files[CONFIG_FILE_NAME]);
  if (!target) throw new Error("Gist not found");
  const file = target.files[CONFIG_FILE_NAME];
  const res = await fetch(file.raw_url);
  return await res.json();
}

async function githubFetch(url, method, token, body = null) {
  const opts = { method, headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Github ${res.status}`);
  return res.json();
}

async function bgWebdavUpload(items, data) {
  const auth = 'Basic ' + btoa(items.davUser + ':' + items.davPass);
  let root = items.davUrl.endsWith('/') ? items.davUrl : items.davUrl + '/';
  const folder = root + DAV_DIR_NAME + '/';
  const target = folder + CONFIG_FILE_NAME;
  await fetch(folder, { method: 'MKCOL', headers: { 'Authorization': auth } });
  const res = await fetch(target, { method: 'PUT', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`Webdav ${res.status}`);
}

async function bgWebdavDownload(items) {
  const auth = 'Basic ' + btoa(items.davUser + ':' + items.davPass);
  let root = items.davUrl.endsWith('/') ? items.davUrl : items.davUrl + '/';
  const target = root + DAV_DIR_NAME + '/' + CONFIG_FILE_NAME;
  const res = await fetch(target, { method: 'GET', headers: { 'Authorization': auth } });
  if (!res.ok) throw new Error(`Webdav ${res.status}`);
  return await res.json();
}

// --- Icons & Sets ---
function updateSets(userArr, whiteArr, gfwArr) {
    if (userArr) cachedUserRules = new Set(userArr);
    if (whiteArr) cachedUserWhitelist = new Set(whiteArr);
    if (gfwArr) cachedGfwDomains = new Set(gfwArr);
}
chrome.proxy.settings.onChange.addListener((details) => {
    if (details && details.value) {
        currentMode = details.value.mode;
        lastDrawState = { color: null, char: null }; 
        updateIconForActiveTab();
    }
});
chrome.tabs.onActivated.addListener(updateIconForActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
        if (activeTabs && activeTabs.length > 0 && activeTabs[0].id === tabId) updateIconForActiveTab();
    });
  }
});
function updateIconForActiveTab() {
  chrome.proxy.settings.get({}, (details) => {
    if (chrome.runtime.lastError) return;
    currentMode = details.value.mode;
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      const state = calculateState(tab.url, currentMode);
      if (state.color === lastDrawState.color && state.char === lastDrawState.char) return;
      drawIcon(state.color, state.char);
      lastDrawState = state;
    });
  });
}
function calculateState(urlStr, mode) {
  let color = "#2196F3"; let char = "D";        
  if (mode === 'fixed_servers') return { color: "#4CAF50", char: "P" };
  else if (mode === 'direct') return { color: "#2196F3", char: "D" };
  else if (mode === 'pac_script') {
    char = "A"; color = "#9E9E9E"; 
    if (urlStr && urlStr.startsWith('http')) {
      try {
        const hostname = new URL(urlStr).hostname;
        const domain = hostname.startsWith('www.') ? hostname.substring(4) : hostname;
        if (checkSet(domain, cachedUserWhitelist)) return { color: "#2196F3", char: "A" };
        if (checkSet(domain, cachedUserRules)) return { color: "#4CAF50", char: "A" };
        if (checkSet(domain, cachedGfwDomains)) return { color: "#4CAF50", char: "A" };
      } catch (e) {}
    }
  }
  return { color, char };
}
function checkSet(domain, setObj) {
    if (setObj.has(domain)) return true;
    const lastDot = domain.lastIndexOf('.');
    if (lastDot > 0) {
        const prevDot = domain.lastIndexOf('.', lastDot - 1);
        if (prevDot !== -1) {
            const root = domain.substring(prevDot + 1);
            if (setObj.has(root)) return true;
        }
    }
    return false;
}
function drawIcon(color, char) {
  chrome.action.setBadgeText({ text: "" });
  const canvas = new OffscreenCanvas(32, 32);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(16, 16, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, 16, 17);
  chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, 32, 32) });
}
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});