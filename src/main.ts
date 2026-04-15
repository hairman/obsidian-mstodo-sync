import { Plugin, Notice, ObsidianProtocolData, addIcon } from 'obsidian';
import { MsTodoSyncSettings } from './interfaces';
import { DEFAULT_SETTINGS } from './constants';
import { AuthManager } from './auth/auth-manager';
import { GraphClient } from './api/graph-client';
import { ObsidianFileManager } from './obsidian/file-manager';
import { SyncEngine } from './core/sync-engine';
import { MsTodoSyncSettingTab } from './ui/settings-tab';
import { t } from './i18n/helpers';

// SVG для логотипа Microsoft To Do в стиле контурных иконок Obsidian (100x100)
const MSTODO_ICON_SVG = `<circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="8" /><path d="M30 52l15 15 30-35" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />`;

export default class MsTodoSyncPlugin extends Plugin {
	settings: MsTodoSyncSettings;
	auth: AuthManager;
	graphClient: GraphClient;
	fileManager: ObsidianFileManager;
	syncEngine: SyncEngine;

	async onload() {
		await this.loadSettings();

		// Регистрация кастомной иконки
		addIcon('mstodo-logo', MSTODO_ICON_SVG);

		this.auth = new AuthManager(this.app, this.settings);
		this.graphClient = new GraphClient(this.auth);
		this.fileManager = new ObsidianFileManager(this.app);
		this.syncEngine = new SyncEngine(this.app, this.settings, this.fileManager, this.graphClient);

		// Добавление кнопки синхронизации на боковую панель с кастомной иконкой
		this.addRibbonIcon('mstodo-logo', t('ribbon.tooltip'), () => {
			this.syncEngine.runSync();
		});

		// Регистрация хендлера протокола для авторизации
		this.registerObsidianProtocolHandler('mstodo-sync-auth', async (data: ObsidianProtocolData) => {
			console.log('[MsTodoSync] Received auth callback data:', data);
			
			if (data.code) {
				new Notice(t('notices.connecting'));
				try {
					const verifier = this.settings.pkceVerifier;
					console.log('[MsTodoSync] Using verifier from settings:', verifier ? 'found' : 'missing');
					
					if (!verifier) {
						throw new Error(t('notices.noVerifier'));
					}

					await this.auth.exchangeCodeForToken(data.code, verifier);
					
					// Очищаем верификатор
					this.settings.pkceVerifier = ''; 
					await this.saveSettings();
					
					new Notice(t('notices.authSuccess'));
					
					// Если есть открытая вкладка настроек, обновляем её
					this.app.workspace.getLeavesOfType('mstodo-sync-settings').forEach(leaf => {
						if (leaf.view instanceof MsTodoSyncSettingTab) {
							(leaf.view as any).display();
						}
					});
				} catch (e) {
					console.error('[MsTodoSync] Auth exchange error:', e);
					new Notice(t('notices.authError', { error: e.message }));
				}
			} else if (data.error) {
				console.error('[MsTodoSync] Microsoft returned error:', data.error, data.error_description);
				new Notice(`${t('notices.authError', { error: data.error_description || data.error })}`);
			}
		});

		// Команды
		this.addCommand({
			id: 'sync-now',
			name: t('commands.syncNow'),
			callback: () => this.syncEngine.runSync()
		});

		this.addCommand({
			id: 'login',
			name: t('commands.login'),
			callback: async () => {
				if (this.settings.clientId === 'YOUR_CLIENT_ID' || !this.settings.clientId) {
					new Notice(t('settings.auth.missingClientId'));
					return;
				}
				
				const verifier = this.auth.generateVerifier();
				this.settings.pkceVerifier = verifier;
				await this.saveSettings();
				
				console.log('[MsTodoSync] Starting login flow. Verifier saved.');
				
				const url = await this.auth.generateAuthUrl(verifier);
				window.open(url);
			}
		});

		this.addCommand({
			id: 'disconnect',
			name: t('commands.disconnect'),
			callback: async () => {
				this.settings.accessToken = '';
				this.settings.refreshToken = '';
				this.settings.tokenExpiresAt = 0;
				this.settings.pkceVerifier = '';
				await this.saveSettings();
				new Notice(t('notices.disconnected'));
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
