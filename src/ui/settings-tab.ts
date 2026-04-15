import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import * as obsidian from 'obsidian';
import MsTodoSyncPlugin from '../main';

export class MsTodoSyncSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MsTodoSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mstodo-sync-settings');

		containerEl.createEl('h2', { text: 'MS To Do Sync Settings' });

		new Setting(containerEl)
			.setName('Microsoft Client ID')
			.setDesc('Your Azure Application Client ID')
			.addText(text => text
				.setPlaceholder('Enter Client ID')
				.setValue(this.plugin.settings.clientId)
				.onChange(async (value) => {
					this.plugin.settings.clientId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Access Token Secret Name')
			.setDesc('Name of the secret in SecretStorage for the access token')
			.addComponent(el => {
				const sc = new (obsidian as any).SecretComponent(this.app, el);
				sc.setValue(this.plugin.settings.accessTokenSecretName)
				  .onChange(async (value: string) => {
					this.plugin.settings.accessTokenSecretName = value;
					await this.plugin.saveSettings();
				  });
				return sc;
			});

		new Setting(containerEl)
			.setName('Refresh Token Secret Name')
			.addComponent(el => {
				const sc = new (obsidian as any).SecretComponent(this.app, el);
				sc.setValue(this.plugin.settings.refreshTokenSecretName)
				  .onChange(async (value: string) => {
					this.plugin.settings.refreshTokenSecretName = value;
					await this.plugin.saveSettings();
				  });
				return sc;
			});

		containerEl.createEl('h3', { text: 'Sync Targets' });

		new Setting(containerEl)
			.setName('Default Todo List')
			.setDesc('MS To Do List to sync with')
			.addDropdown(async (dropdown) => {
				dropdown.addOption('', 'Loading...');
				try {
					const lists = await this.plugin.graphClient.getTodoLists();
					dropdown.selectEl.empty();
					dropdown.addOption('', 'Select a list');
					lists.forEach((list: any) => {
						dropdown.addOption(list.id, list.displayName);
					});
					dropdown.setValue(this.plugin.settings.defaultTodoListId);
				} catch (e) {
					dropdown.addOption('', 'Error loading lists');
				}
				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultTodoListId = value;
					this.plugin.settings.deltaToken = ''; // Сброс при смене списка
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Task Notes Folder')
			.setDesc('Folder where individual task notes will be stored')
			.addText(text => text
				.setValue(this.plugin.settings.taskNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.taskNotesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Daily Note Folder')
			.addText(text => text
				.setValue(this.plugin.settings.dailyNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Daily Note Filename Pattern')
			.setDesc('Moment.js pattern (e.g. YYYY-MM-DD)')
			.addText(text => text
				.setValue(this.plugin.settings.dailyNoteFilenamePattern)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteFilenamePattern = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Sync Behavior' });

		new Setting(containerEl)
			.setName('Sync Interval (Minutes)')
			.setDesc('Set to 0 to disable auto-sync')
			.addText(text => text
				.setValue(String(this.plugin.settings.syncIntervalMinutes))
				.onChange(async (value) => {
					this.plugin.settings.syncIntervalMinutes = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Conflict Strategy')
			.addDropdown(dropdown => dropdown
				.addOption('remote-wins', 'Remote Wins')
				.addOption('local-wins', 'Local Wins')
				.addOption('newest-wins', 'Newest Wins')
				.setValue(this.plugin.settings.conflictStrategy)
				.onChange(async (value: any) => {
					this.plugin.settings.conflictStrategy = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync Tag')
			.setDesc('Only tasks with this tag will be synced')
			.addText(text => text
				.setValue(this.plugin.settings.syncTag)
				.onChange(async (value) => {
					this.plugin.settings.syncTag = value;
					await this.plugin.saveSettings();
				}));
	}
}
