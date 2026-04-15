import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MsTodoSyncPlugin from '../main';
import { FileSuggest, FolderSuggest } from './suggest';
import { t } from '../i18n/helpers';

export class MsTodoSyncSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MsTodoSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mstodo-sync-settings');

		containerEl.createEl('h2', { text: t('settings.title') });

		new Setting(containerEl)
			.setName(t('settings.auth.clientId'))
			.setDesc(t('settings.auth.clientIdDesc'))
			.addText(text => text
				.setPlaceholder('Enter Client ID')
				.setValue(this.plugin.settings.clientId)
				.onChange(async (value) => {
					this.plugin.settings.clientId = value;
					await this.plugin.saveSettings();
				}));

		const statusSetting = new Setting(containerEl)
			.setName(t('settings.auth.status'));
		
		if (this.plugin.settings.accessToken) {
			statusSetting.setDesc(t('settings.auth.connected'));
			statusSetting.addButton(button => button
				.setButtonText(t('settings.auth.logout'))
				.onClick(async () => {
					this.plugin.settings.accessToken = '';
					this.plugin.settings.refreshToken = '';
					this.plugin.settings.tokenExpiresAt = 0;
					await this.plugin.saveSettings();
					this.display();
					new Notice(t('settings.auth.logoutSuccess'));
				}));
		} else {
			statusSetting.setDesc(t('settings.auth.notConnected'));
			statusSetting.addButton(button => button
				.setButtonText(t('settings.auth.login'))
				.setWarning()
				.onClick(async () => {
					(this.plugin.app as any).commands.executeCommandById('obsidian-mstodo-sync-v2:login');
				}));
		}

		containerEl.createEl('h3', { text: t('settings.targets.header') });

		new Setting(containerEl)
			.setName(t('settings.targets.todoList'))
			.setDesc(t('settings.targets.todoListDesc'))
			.addDropdown(async (dropdown) => {
				dropdown.addOption('', t('settings.targets.todoListLoading'));
				try {
					const lists = await this.plugin.graphClient.getTodoLists();
					dropdown.selectEl.empty();
					dropdown.addOption('', t('settings.targets.todoListSelect'));
					lists.forEach((list: any) => {
						dropdown.addOption(list.id, list.displayName);
					});
					dropdown.setValue(this.plugin.settings.defaultTodoListId);
				} catch (e) {
					dropdown.addOption('', t('settings.targets.todoListError'));
				}
				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultTodoListId = value;
					this.plugin.settings.deltaToken = ''; // Сброс при смене списка
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.targets.notesFolder'))
			.setDesc(t('settings.targets.notesFolderDesc'))
			.addText(text => {
				new FolderSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.taskNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.taskNotesFolder = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.targets.dailyNoteFolder'))
			.setDesc(t('settings.targets.dailyNoteFolderDesc'))
			.addText(text => {
				new FolderSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.dailyNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteFolder = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.targets.filenamePattern'))
			.setDesc(t('settings.targets.filenamePatternDesc'))
			.addText(text => text
				.setValue(this.plugin.settings.dailyNoteFilenamePattern)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteFilenamePattern = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settings.targets.templatePath'))
			.setDesc(t('settings.targets.templatePathDesc'))
			.addText(text => {
				new FileSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.dailyNoteTemplatePath)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteTemplatePath = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.targets.section'))
			.setDesc(t('settings.targets.sectionDesc'))
			.addText(text => text
				.setValue(this.plugin.settings.dailyNoteSection)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteSection = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: t('settings.behavior.header') });

		new Setting(containerEl)
			.setName(t('settings.behavior.interval'))
			.setDesc(t('settings.behavior.intervalDesc'))
			.addText(text => text
				.setValue(String(this.plugin.settings.syncIntervalMinutes))
				.onChange(async (value) => {
					this.plugin.settings.syncIntervalMinutes = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settings.behavior.conflict'))
			.addDropdown(dropdown => dropdown
				.addOption('remote-wins', t('settings.behavior.conflictOptions.remote'))
				.addOption('local-wins', t('settings.behavior.conflictOptions.local'))
				.addOption('newest-wins', t('settings.behavior.conflictOptions.newest'))
				.setValue(this.plugin.settings.conflictStrategy)
				.onChange(async (value: any) => {
					this.plugin.settings.conflictStrategy = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settings.behavior.tag'))
			.setDesc(t('settings.behavior.tagDesc'))
			.addText(text => text
				.setValue(this.plugin.settings.syncTag)
				.onChange(async (value) => {
					this.plugin.settings.syncTag = value;
					await this.plugin.saveSettings();
				}));
	}
}
