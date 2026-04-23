import { App, TFile, Notice, moment, normalizePath } from 'obsidian';
import { MsTodoSyncSettings, GraphTask, TaskFrontMatter } from '../interfaces';
import { ObsidianFileManager } from '../obsidian/file-manager';
import { GraphClient } from '../api/graph-client';
import { t } from '../i18n/helpers';

export class SyncEngine {
	private isSyncing = false;
	private stats = {
		created: 0,
		updated: 0,
		deleted: 0,
		conflicts: 0,
		remoteCreated: 0,
		remoteUpdated: 0
	};

	constructor(
		private app: App,
		private settings: MsTodoSyncSettings,
		private fileManager: ObsidianFileManager,
		private graphClient: GraphClient
	) {}

	async runSync() {
		if (this.isSyncing) {
			new Notice(t('notices.syncing'));
			return;
		}

		if (!this.settings.accessToken) {
			new Notice(t('notices.authError', { error: t('settings.auth.notConnected') }));
			return;
		}

		this.isSyncing = true;
		this.resetStats();
		new Notice(t('notices.syncing'));

		try {
			// 1. Предварительное сканирование локальных изменений в Daily Notes
			await this.preSyncLocalScan();

			// 2. Сбор новых задач из Obsidian (по тегу)
			await this.collectNewTasksFromObsidian();
			
			// 3. Получение изменений из Microsoft To Do (Delta Sync)
			await this.importFromRemote();
			
			// 4. Отправка локальных изменений в Microsoft To Do
			await this.exportToRemote();

			this.showSummary();
		} catch (e) {
			console.error('[MsTodoSync] Sync error:', e);
			new Notice(t('notices.syncFailed', { error: (e as Error).message }));
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Сканирует все файлы задач и проверяет их состояние в Daily Notes.
	 * Если состояние изменилось, помечает задачу как 'pending' для экспорта.
	 */
	private async preSyncLocalScan() {
		const taskFiles = this.getTaskFiles();
		for (const file of taskFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter as TaskFrontMatter | undefined;
			if (!fm || !fm.sourceDailyNotePath || !fm.sourceBlockId) continue;

			const dailyFile = this.app.vault.getAbstractFileByPath(fm.sourceDailyNotePath);
			if (dailyFile instanceof TFile) {
				const content = await this.app.vault.read(dailyFile);
				const blockRegex = new RegExp(`- \\[([ xX])\\].*\\^${fm.sourceBlockId}`);
				const match = content.match(blockRegex);

				if (match) {
					const isCompleted = match[1].toLowerCase() === 'x';
					if (isCompleted !== fm.localCompleted) {
						await this.fileManager.updateTaskMetadata(file, {
							localCompleted: isCompleted,
							localUpdatedAt: Date.now(),
							msTodoSyncStatus: 'pending'
						});
					}
				}
			}
		}
	}

	private resetStats() {
		this.stats = {
			created: 0,
			updated: 0,
			deleted: 0,
			conflicts: 0,
			remoteCreated: 0,
			remoteUpdated: 0
		};
	}

	private showSummary() {
		const { created, updated, remoteCreated, remoteUpdated, conflicts } = this.stats;
		
		if (created === 0 && updated === 0 && remoteCreated === 0 && remoteUpdated === 0) {
			new Notice(t('notices.syncNoChanges'));
			return;
		}

		let message = t('notices.syncComplete') + '\n';
		if (remoteCreated > 0) message += t('notices.summary.sent', { count: String(remoteCreated) }) + '\n';
		if (remoteUpdated > 0) message += t('notices.summary.updatedRemote', { count: String(remoteUpdated) }) + '\n';
		if (created > 0) message += t('notices.summary.imported', { count: String(created) }) + '\n';
		if (updated > 0) message += t('notices.summary.updatedLocal', { count: String(updated) }) + '\n';
		if (conflicts > 0) message += t('notices.summary.conflicts', { count: String(conflicts) }) + '\n';

		new Notice(message, 5000);
		console.debug('[MsTodoSync] Sync complete stats:', this.stats);
	}

	private async collectNewTasksFromObsidian() {
		const { syncTag, taskNotesFolder } = this.settings;
		if (!syncTag) return;
		
		// Используем метаданные вместо чтения всех файлов
		const allFiles = this.app.vault.getMarkdownFiles();
		
		for (const file of allFiles) {
			if (file.path.startsWith(taskNotesFolder)) continue;

			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			// Проверяем наличие тега в кэше
			const hasTag = cache.tags?.some(tag => tag.tag === syncTag) || 
						cache.frontmatter?.tags?.includes(syncTag.replace('#', ''));
			
			if (!hasTag) {
				// Дополнительная проверка: тег может быть просто текстом в строке, 
				// но если его нет в кэше тегов, значит он не индексирован как тег.
				// Однако для надежности и производительности полагаемся на кэш.
				continue;
			}

			const content = await this.app.vault.read(file);
			const lines = content.split('\n');
			let changed = false;
			const newLines = [...lines];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line.includes(syncTag) && line.trim().startsWith('- [') && !line.includes(' ^')) {
					const match = line.match(/- \[([ xX])\]\s*(.*?)\s*(#\S+)/);
					if (match) {
						const completed = match[1].toLowerCase() === 'x';
						const title = match[2].trim();
						const blockId = this.fileManager.generateBlockId();
						
						const metadata: TaskFrontMatter = {
							msTodoId: '',
							msTodoListId: this.settings.defaultTodoListId,
							msTodoEtag: '',
							msTodoLastModifiedDateTime: '',
							msTodoSyncStatus: 'pending',
							sourceDailyNotePath: file.path,
							sourceBlockId: blockId,
							syncTag: syncTag,
							localCompleted: completed,
							lastSyncedCompleted: false,
							localUpdatedAt: Date.now()
						};

						await this.fileManager.createTaskFile(this.settings.taskNotesFolder, title, metadata);
						newLines[i] = `${line.trim()} ^${blockId}`;
						changed = true;
						this.stats.remoteCreated++;
					}
				}
			}

			if (changed) {
				await this.app.vault.modify(file, newLines.join('\n'));
			}
		}
	}

	private async importFromRemote() {
		const result = await this.graphClient.getTasksDelta(this.settings.defaultTodoListId, this.settings.deltaToken);
		
		for (const remoteTask of result.value) {
			const localFile = this.fileManager.findTaskFileById(remoteTask.id, this.settings.taskNotesFolder);

			if (localFile) {
				const fm = this.app.metadataCache.getFileCache(localFile)?.frontmatter as TaskFrontMatter;
				const isModifiedLocally = fm.localCompleted !== fm.lastSyncedCompleted;
				const isModifiedRemotely = remoteTask['@odata.etag'] !== fm.msTodoEtag;

				if (isModifiedLocally && isModifiedRemotely) {
					await this.resolveConflict(localFile, fm, remoteTask);
					this.stats.conflicts++;
				} else if (isModifiedRemotely) {
					await this.applyRemoteUpdate(localFile, fm, remoteTask);
					this.stats.updated++;
				}
			} else if (remoteTask.status !== 'deleted') {
				await this.createNewLocalTask(remoteTask);
				this.stats.created++;
			}
		}

		if (result.deltaToken) {
			this.settings.deltaToken = result.deltaToken;
		}
	}

	private async exportToRemote() {
		const taskFiles = this.getTaskFiles();
		this.stats.remoteCreated = 0; 

		for (const file of taskFiles) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as TaskFrontMatter;
			if (!fm || fm.msTodoSyncStatus !== 'pending') continue;

			try {
				if (fm.msTodoId) {
					const remoteTask = await this.graphClient.updateTask(this.settings.defaultTodoListId, fm.msTodoId, {
						status: fm.localCompleted ? 'completed' : 'notStarted'
					});
					await this.fileManager.updateTaskMetadata(file, {
						msTodoEtag: remoteTask['@odata.etag'],
						lastSyncedCompleted: fm.localCompleted,
						msTodoSyncStatus: 'synced'
					});
					this.stats.remoteUpdated++;
				} else {
					const title = file.basename;
					const remoteTask = await this.graphClient.createTask(this.settings.defaultTodoListId, title);
					
					if (fm.localCompleted) {
						await this.graphClient.updateTask(this.settings.defaultTodoListId, remoteTask.id, {
							status: 'completed'
						});
					}

					await this.fileManager.updateTaskMetadata(file, {
						msTodoId: remoteTask.id,
						msTodoEtag: remoteTask['@odata.etag'],
						msTodoLastModifiedDateTime: remoteTask.lastModifiedDateTime,
						lastSyncedCompleted: fm.localCompleted,
						msTodoSyncStatus: 'synced'
					});
					this.stats.remoteCreated++;
				}
			} catch (e) {
				console.error(`[MsTodoSync] Failed to export task ${file.path}:`, e);
			}
		}
	}

	private async applyRemoteUpdate(file: TFile, fm: TaskFrontMatter, remote: GraphTask) {
		const remoteCompleted = remote.status === 'completed';
		await this.fileManager.updateTaskMetadata(file, {
			localCompleted: remoteCompleted,
			lastSyncedCompleted: remoteCompleted,
			msTodoEtag: remote['@odata.etag'],
			msTodoLastModifiedDateTime: remote.lastModifiedDateTime,
			msTodoSyncStatus: 'synced'
		});

		if (fm.sourceDailyNotePath && fm.sourceBlockId) {
			await this.fileManager.updateDailyNoteCheckbox(fm.sourceDailyNotePath, fm.sourceBlockId, remoteCompleted);
		}
	}

	private async resolveConflict(file: TFile, fm: TaskFrontMatter, remote: GraphTask) {
		let winRemote = false;
		if (this.settings.conflictStrategy === 'remote-wins') winRemote = true;
		else if (this.settings.conflictStrategy === 'newest-wins') {
			const remoteTs = new Date(remote.lastModifiedDateTime).getTime();
			winRemote = remoteTs > fm.localUpdatedAt;
		}

		if (winRemote) {
			await this.applyRemoteUpdate(file, fm, remote);
		} else {
			await this.fileManager.updateTaskMetadata(file, { msTodoSyncStatus: 'pending' });
		}
	}

	private async createNewLocalTask(remote: GraphTask) {
		const blockId = this.fileManager.generateBlockId();
		const createdDate = moment.utc(remote.createdDateTime).local();
		const dailyNotePath = this.getDailyNotePath(createdDate);
		
		const metadata: TaskFrontMatter = {
			msTodoId: remote.id,
			msTodoListId: this.settings.defaultTodoListId,
			msTodoEtag: remote['@odata.etag'],
			msTodoLastModifiedDateTime: remote.lastModifiedDateTime,
			msTodoSyncStatus: 'synced',
			sourceDailyNotePath: dailyNotePath,
			sourceBlockId: blockId,
			syncTag: this.settings.syncTag,
			localCompleted: remote.status === 'completed',
			lastSyncedCompleted: remote.status === 'completed',
			localUpdatedAt: Date.now()
		};

		await this.fileManager.createTaskFile(this.settings.taskNotesFolder, remote.title, metadata);
		
		if (this.settings.createDailyNoteIfMissing) {
			await this.addToListInDailyNote(dailyNotePath, blockId, remote.title, remote.status === 'completed');
		}
	}

	private getDailyNotePath(date: moment.Moment): string {
		const folder = this.settings.dailyNoteFolder;
		const filename = date.format(this.settings.dailyNoteFilenamePattern) + '.md';
		return normalizePath(`${folder}/${filename}`);
	}

	private async addToListInDailyNote(path: string, blockId: string, title: string, completed: boolean) {
		const file = this.app.vault.getAbstractFileByPath(path);
		let content = '';
		if (file instanceof TFile) {
			content = await this.app.vault.read(file);
		} else {
			// Создаем из шаблона или пустой
			if (this.settings.dailyNoteTemplatePath) {
				const templateFile = this.app.vault.getAbstractFileByPath(this.settings.dailyNoteTemplatePath);
				if (templateFile instanceof TFile) {
					content = await this.app.vault.read(templateFile);
				}
			}
		}

		const statusChar = completed ? 'x' : ' ';
		const newTaskLine = `- [${statusChar}] ${title} ${this.settings.syncTag} ^${blockId}`;
		
		const section = this.settings.dailyNoteSection;
		let newContent = '';

		if (content.includes(section)) {
			newContent = content.replace(section, `${section}\n${newTaskLine}`);
		} else {
			newContent = content + `\n\n${section}\n${newTaskLine}`;
		}

		if (file instanceof TFile) {
			await this.app.vault.modify(file, newContent);
		} else {
			await this.fileManager.ensureFolder(this.settings.dailyNoteFolder);
			await this.app.vault.create(path, newContent);
		}
	}

	private getTaskFiles(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter(file => 
			file.path.startsWith(this.settings.taskNotesFolder)
		);
	}
}
