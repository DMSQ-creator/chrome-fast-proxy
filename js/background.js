// background.js - v5.1.0

let cachedUserRules = new Set();
let cachedGfwDomains = new Set();
let currentMode = 'direct';
let lastDrawState = { color: null, char: null };

// 1. 初始化
chrome.storage.local.get(['userRules', 'gfwDomains'], (items) => {
  updateSets(items.userRules, items.gfwDomains);
});

// 2. 监听数据变化
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    const newUser = changes.userRules ? changes.userRules.newValue : null;
    const newGfw = changes.gfwDomains ? changes.gfwDomains.newValue : null;
    if (newUser || newGfw) {
        chrome.storage.local.get(['userRules', 'gfwDomains'], (items) => {
            updateSets(items.userRules, items.gfwDomains);
            updateIconForActiveTab();
        });
    }
  }
});

function updateSets(userArr, gfwArr) {
    if (userArr) cachedUserRules = new Set(userArr);
    if (gfwArr) cachedGfwDomains = new Set(gfwArr);
}

// 3. 监听模式变化
chrome.proxy.settings.onChange.addListener((details) => {
    if (details && details.value) {
        currentMode = details.value.mode;
        lastDrawState = { color: null, char: null }; 
        updateIconForActiveTab();
    }
});

// 4. 监听标签切换与更新
chrome.tabs.onActivated.addListener(updateIconForActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
        if (activeTabs && activeTabs.length > 0 && activeTabs[0].id === tabId) {
            updateIconForActiveTab();
        }
    });
  }
});

// --- 核心逻辑 ---

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
  let color = "#2196F3"; 
  let char = "D";        

  if (mode === 'fixed_servers') {
    return { color: "#4CAF50", char: "P" };
  } 
  else if (mode === 'direct') {
    return { color: "#2196F3", char: "D" };
  } 
  else if (mode === 'pac_script') {
    char = "A"; 
    color = "#9E9E9E"; 
    
    if (urlStr && urlStr.startsWith('http')) {
      try {
        const hostname = new URL(urlStr).hostname;
        const domain = hostname.startsWith('www.') ? hostname.substring(4) : hostname;
        
        if (cachedUserRules.has(domain)) return { color: "#4CAF50", char: "A" };
        if (cachedGfwDomains.has(domain)) return { color: "#4CAF50", char: "A" };
        
        const lastDot = domain.lastIndexOf('.');
        if (lastDot > 0) {
            const prevDot = domain.lastIndexOf('.', lastDot - 1);
            if (prevDot !== -1) {
                const root = domain.substring(prevDot + 1);
                if (cachedGfwDomains.has(root)) return { color: "#4CAF50", char: "A" };
            }
        }
      } catch (e) {}
    }
  }
  return { color, char };
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

// --- 新增：安装后自动打开设置页 ---
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});