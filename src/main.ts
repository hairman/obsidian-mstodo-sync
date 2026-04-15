import { Plugin, Notice, ObsidianProtocolData } from 'obsidian';
import { MsTodoSyncSettings } from './interfaces';
import { DEFAULT_SETTINGS } from './constants';
import { AuthManager } from './auth/auth-manager';
import { GraphClient } from './api/graph-client';
import { ObsidianFileManager } from './obsidian/file-manager';
import { SyncEngine } from './core/sync-engine';
import { MsTodoSyncSettingTab } from './ui/settings-tab';

export default class MsTodoSyncPlugin extends Plugin {
	settings: MsTodoSyncSettings;
	auth: AuthManager;
	graphClient: GraphClient;
	fileManager: ObsidianFileManager;
	syncEngine: SyncEngine;
	private pkceVerifier: string;

	async onload() {
		await this.loadSettings();

		this.auth = new AuthManager(this.app, this.settings);
		this.graphClient = new GraphClient(this.auth);
		this.fileManager = new ObsidianFileManager(this.app);
		this.syncEngine = new SyncEngine(this.app, this.settings, this.fileManager, this.graphClient);

		// Регистрация хендлера протокола для авторизации
		this.registerObsidianProtocolHandler('mstodo-sync-auth', async (data: ObsidianProtocolData) => {
			if (data.code) {
				try {
					await this.auth.exchangeCodeForToken(data.code, this.pkceVerifier);
					await this.saveSettings();
					new Notice('Successfully connected to Microsoft To Do!');
				} catch (e) {
					console.error('[MsTodoSync] Auth error:', e);
					new Notice('Failed to connect to Microsoft To Do');
				}
			}
		});

		// Команды
		this.addCommand({
			id: 'sync-now',
			name: 'Sync now',
			callback: () => this.syncEngine.runSync()
		});

		this.addCommand({
			id: 'login',
			name: 'Login / Connect Microsoft account',
			callback: async () => {
				if (this.settings.clientId === 'YOUR_CLIENT_ID') {
					new Notice('Please set your Client ID in settings first');
					return;
				}
				this.pkceVerifier = this.auth.generateVerifier();
				const url = await this.auth.generateAuthUrl(this.pkceVerifier);
				window.open(url);
			}
		});

		this.addCommand({
			id: 'disconnect',
			name: 'Disconnect account',
			callback: async () => {
				(this.app as any).secretStorage.delete(this.settings.accessTokenSecretName);
				(this.app as any).secretStorage.delete(this.settings.refreshTokenSecretName);
				this.settings.tokenExpiresAt = 0;
				await this.saveSettings();
				new Notice('Disconnected from Microsoft To Do');
			}
		});

		// Настройка интервала синхронизации
		this.setupAutoSync();

		// Вкладка настроек
		this.addSettingTab(new MsTodoSyncSettingTab(this.app, this));
	}

	private setupAutoSync() {
		if (this.settings.syncIntervalMinutes > 0) {
			this.registerInterval(
				window.setInterval(() => {
					this.syncEngine.runSync();
				}, this.settings.syncIntervalMinutes * 60 * 1000)
			);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
