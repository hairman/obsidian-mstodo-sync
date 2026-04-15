# Microsoft To Do Sync

An advanced two-way synchronization plugin for [Obsidian](https://obsidian.md) that bridges your notes and **Microsoft To Do** tasks. It leverages native Obsidian Block IDs to maintain data integrity and provides seamless integration with your Daily Notes.

## ✨ Key Features

- **Robust Two-Way Sync**: Keeps your tasks in sync between Obsidian and Microsoft To Do.
- **Advanced Daily Note Integration**:
    - Automatically routes imported tasks to Daily Notes based on creation date.
    - Highly customizable templates with support for placeholders like `{{TITLE}}` and `{{date}}`.
    - Smart section insertion for new tasks.
- **Task Discovery**: Automatically discovers tasks throughout your vault using custom sync tags.
- **UI & UX**:
    - Intuitive Ribbon button with custom branding.
    - Seamless settings with folder/file path autocompletion.
    - Streamlined notifications for sync status and errors.
- **Reliable Auth**: Secure Microsoft OAuth2 flow with PKCE support and automated token management.

## 🛠️ Installation

### Community Plugins
1. Open Obsidian **Settings** -> **Community Plugins**.
2. Click **Browse** and search for "Microsoft To Do Sync".
3. Click **Install** and then **Enable**.

### Manual Installation
1. Download the latest `main.js`, `manifest.json`, and `styles.css` from the [GitHub Releases page](https://github.com/hairman/obsidian-mstodo-sync/releases).
2. Create a folder in your vault at `.obsidian/plugins/microsoft-to-do-sync/`.
3. Place the downloaded files into this folder.
4. Restart Obsidian and enable the plugin in your settings.

## 📖 Quick Start

1. **Setup**: Go to the plugin settings and provide your **Microsoft Client ID**.
2. **Connect**: Click the "Login" button to authorize the plugin with your Microsoft account.
3. **Configure Sync**:
    - Set your **Sync Tag** (e.g., `#todo`).
    - Define your **Daily Notes Folder** and preferred **Section** (e.g., `## Tasks`).
    - Customize your task template to match your workflow.
4. **Sync**: Click the ribbon button or use the Command Palette (`Ctrl/Cmd + P`) to trigger "Sync now".

## 🚀 Usage

- **Discovery**: Any task in your vault formatted as `- [ ] Task content #todo` (without a block ID) will be automatically detected and synced.
- **Block IDs**: The plugin will automatically append a unique block ID (e.g., `^abc123`) to your tasks after the first sync to track them reliably.
- **Two-Way Updates**: Changes made in Obsidian will reflect in MS To Do, and remote updates from MS To Do will be pulled down to your notes during the next sync.

## 🛡️ Support
If you encounter any issues or have feature requests, please check the [GitHub Issues](https://github.com/hairman/obsidian-mstodo-sync/issues).

## 📄 License
[MIT License](LICENSE)
