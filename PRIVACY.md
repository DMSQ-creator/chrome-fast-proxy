# Privacy Policy for FastProxy

**Last Updated: December 9, 2025**

FastProxy ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how our Chrome extension handles your data.

## 1. Data Collection

**We do not collect, store, or transmit any of your personal data.**

*   **Browsing History**: FastProxy processes your browsing requests locally on your device to determine whether to use a proxy server based on your rules (PAC script). We do not send your browsing history to any external servers.
*   **Proxy Configuration**: Your server details (IP, port) and custom rules are stored locally within your browser using the Chrome Storage API (`chrome.storage.local`). They are not synced to our servers.

## 2. Permissions Usage

*   **proxy**: Required to control the browser's proxy settings to route traffic according to your configuration.
*   **tabs**: Required to identify the current website's domain to display its proxy status in the popup interface and to update the extension icon dynamically.
*   **storage**: Required to save your preferences, proxy server settings, and custom rules locally.

## 3. Third-Party Services

FastProxy allows you to download rule lists (e.g., GFWList) from third-party sources (e.g., GitHub). When you click "Update", your IP address may be visible to the hosting provider of that list, subject to their own privacy policies.

## 4. Contact Us

If you have any questions about this Privacy Policy, please file an issue on our GitHub repository.
