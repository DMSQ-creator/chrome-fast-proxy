# 🚀 FastProxy (极速代理)

FastProxy 是一个基于 Chrome Manifest V3 标准开发的轻量级代理管理插件。
它的设计初衷是解决 ZeroOmega 等插件在新版浏览器中 UI 渲染慢、规则匹配效率低的问题。

## ✨ 核心特性

*   **⚡ 极致性能**：放弃低效的数组遍历，采用 `Set` 哈希索引 (Hash Map) 进行规则匹配，查找速度为 **O(1)**。无论规则库有几万条，匹配耗时均为 0ms。
*   **🎨 智能图标**：后台实时计算当前 Tab 的路由状态。
    *   **A (Green)**: 自动模式且走代理
    *   **A (Grey)**: 自动模式且直连
    *   **P**: 全局代理
    *   **D**: 直接连接
*   **🧠 智能分流**：
    *   内置 GFWList 本地缓存（一键更新，无需时刻联网）。
    *   支持自定义规则列表（可视化标签管理）。
    *   支持顶部快捷添加/移除当前域名。
*   **🛡️ 隐私安全**：完全离线运行，无任何远程服务器交互，无用户数据收集。
*   **🍃 极简 UI**：原生 HTML/CSS 编写，无 Vue/React 等重型框架，秒开面板。

## 📦 安装说明

1.  Clone 本仓库或下载 ZIP 包解压。
2.  打开 Chrome 扩展管理页 `chrome://extensions/`。
3.  开启右上角 **Developer mode (开发者模式)**。
4.  点击 **Load unpacked (加载已解压的扩展程序)** 并选择项目文件夹。

## 📖 使用指南

### 1. 基础配置
*   填写你的代理工具（Clash/v2rayN）的本地 SOCKS5/HTTP 端口（默认为 127.0.0.1:7890）。

### 2. 规则更新 (GFWList)
*   由于 GFWList 托管在 GitHub，首次使用请先切换到 **“全局代理”** 模式。
*   点击 **“更新 GFWList”** 按钮，待提示成功后，切换回 **“自动分流”** 即可。

### 3. 自定义规则
*   在浏览网页时，点击插件图标，顶部会自动识别当前域名。
*   点击 **“➕ 添加到列表”** 即可强制该域名走代理。
*   也可以在下方的管理面板手动输入域名添加。

## 🛠️ 技术栈
*   JavaScript (ES6+)
*   Chrome Extension Manifest V3
*   OffscreenCanvas API (用于动态生成图标)
*   Chrome Proxy API & PAC Scripts

## 📝 License
MIT License
