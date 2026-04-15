import { App, Notice, TFile, moment, TFolder } from 'obsidian';
import { MsTodoSyncSettings, TaskFrontMatter, GraphTask } from '../interfaces';
import { ObsidianFileManager } from '../obsidian/file-manager';
import { GraphClient } from '../api/graph-client';

export class SyncEngine {
	private stats = {
		created: 0,
		updated: 0,
		remoteCreated: 0,
		remoteUpdated: 0,
		conflicts: 0
	};

	constructor(
		private app: App,
		private settings: MsTodoSyncSettings,
		private fileManager: ObsidianFileManager,
		private graphClient: GraphClient
	) {}

	async runSync() {
		this.resetStats();
		try {
			if (!this.settings.defaultTodoListId) {
				new Notice('Please select a default Todo List in settings');
				return;
			}

			new Notice('Syncing with Microsoft To Do...');

			// 1. Pre-sync: сканируем локальные изменения
			await this.preSyncLocalScan();
			
			// Сканируем ВСЕ заметки на наличие новых задач с тегом
			await this.scanAllNotesForNewTasks();

			// 2. Import: получаем изменения из MS To Do
			await this.importFromRemote();

			// 3. Export: отправляем локальные изменения в MS To Do
			await this.exportToRemote();

			this.showSyncSummary();
		} catch (e) {
			console.error('[MsTodoSync] Sync error:', e);
			new Notice(`Sync failed: ${e.message}`);
		}
	}

	private resetStats() {
		this.stats = { created: 0, updated: 0, remoteCreated: 0, remoteUpdated: 0, conflicts: 0 };
	}

	private showSyncSummary() {
		const { created, updated, remoteCreated, remoteUpdated, conflicts } = this.stats;
		let message = 'Sync completed successfully!\n';
		if (remoteCreated > 0) message += `+ ${remoteCreated} tasks sent to MS To Do\n`;
		if (remoteUpdated > 0) message += `↑ ${remoteUpdated} tasks updated in MS To Do\n`;
		if (created > 0) message += `+ ${created} tasks imported to Obsidian\n`;
		if (updated > 0) message += `↑ ${updated} tasks updated in Obsidian\n`;
		if (conflicts > 0) message += `⚠ ${conflicts} conflicts resolved\n`;
		
		if (created === 0 && updated === 0 && remoteCreated === 0 && remoteUpdated === 0) {
			message = 'Sync completed. No changes found.';
		}

		new Notice(message, 5000);
	}

	/**
	 * Сканирует все файлы задач и проверяет их состояние в Daily Notes.
	 */
	private async preSyncLocalScan() {
		const taskFiles = this.getTaskFiles();
		for (const file of taskFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter as TaskFrontMatter;
			if (!fm || !fm.sourceDailyNotePath || !fm.sourceBlockId) continue;

			const sourceFile = this.app.vault.getAbstractFileByPath(fm.sourceDailyNotePath);
			if (sourceFile instanceof TFile) {
				const content = await this.app.vault.read(sourceFile);
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

	/**
	 * Ищет новые задачи с тегом во ВСЕХ заметках.
	 */
	private async scanAllNotesForNewTasks() {
		const allFiles = this.app.vault.getMarkdownFiles();
		const syncTag = this.settings.syncTag;
		const taskNotesFolder = this.settings.taskNotesFolder;
		
		for (const file of allFiles) {
			// Пропускаем саму папку с задачами
			if (file.path.startsWith(taskNotesFolder)) continue;

			const content = await this.app.vault.read(file);
			if (!content.includes(syncTag)) continue;

			const lines = content.split('\n');
			let changed = false;
			const newLines = [...lines];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Ищем строки вида: - [ ] Задача #tag (без ^blockId на конце)
				if (line.includes(syncTag) && line.trim().startsWith('- [') && !line.includes(' ^')) {
					const match = line.match(/- \[([ xX])\]\s*(.*?)\s*(#\S+)/);
					if (match) {
						const completed = match[1].toLowerCase() === 'x';
						const title = match[2].trim();
						const blockId = this.fileManager.generateBlockId();
						
						// Создаем локальный файл задачи без msTodoId
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
						
						// Обновляем строку в заметке, добавляя blockId
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

	/**
	 * Импорт изменений из MS To Do (Delta Sync).
	 */
	private async importFromRemote() {
		const result = await this.graphClient.getTasksDelta(this.settings.defaultTodoListId, this.settings.deltaToken);
		
		for (const remoteTask of result.value) {
			const localFile = await this.fileManager.findTaskFileById(remoteTask.id, this.settings.taskNotesFolder);

			if (localFile) {
				const fm = this.app.metadataCache.getFileCache(localFile)?.frontmatter as TaskFrontMatter;
				
				// Проверка конфликта
				const isModifiedLocally = fm.localCompleted !== fm.lastSyncedCompleted;
				const isModifiedRemotely = remoteTask['@odata.etag'] !== fm.msTodoEtag;

				if (isModifiedLocally && isModifiedRemotely) {
					await this.resolveConflict(localFile, fm, remoteTask);
					this.stats.conflicts++;
				} else if (isModifiedRemotely) {
					// Просто обновляем локальную версию
					await this.applyRemoteUpdate(localFile, fm, remoteTask);
					this.stats.updated++;
				}
			} else if (remoteTask.status !== 'deleted') { // Graph API может возвращать удаленные
				// Создаем новую задачу локально, если её еще нет
				await this.createNewLocalTask(remoteTask);
				this.stats.created++;
			}
		}

		// Сохраняем дельта-токен для следующего раза
		if (result.deltaToken) {
			this.settings.deltaToken = result.deltaToken;
		}
	}

	/**
	 * Экспорт локальных изменений в MS To Do.
	 */
	private async exportToRemote() {
		const taskFiles = this.getTaskFiles();
		const currentRemoteCreated = this.stats.remoteCreated;
		this.stats.remoteCreated = 0; // Сбрасываем счетчик для точного подсчета

		for (const file of taskFiles) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as TaskFrontMatter;
			if (!fm || fm.msTodoSyncStatus !== 'pending') continue;

			try {
				if (fm.msTodoId) {
					// Обновление существующей задачи
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
					// Создание новой задачи в MS To Do
					const title = file.basename;
					const remoteTask = await this.graphClient.createTask(this.settings.defaultTodoListId, title);
					
					// Если в Obsidian она была помечена как выполненная, обновляем статус в MS To Do сразу
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
			// Локальная версия побеждает — пометим как pending для экспорта
			await this.fileManager.updateTaskMetadata(file, { msTodoSyncStatus: 'pending' });
		}
	}

	private async createNewLocalTask(remote: GraphTask) {
		const blockId = this.fileManager.generateBlockId();
		// Используем дату создания задачи для определения Daily Note
		const createdDate = moment(remote.createdDateTime);
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

		const file = await this.fileManager.createTaskFile(this.settings.taskNotesFolder, remote.title, metadata);
		
		// Добавляем чекбокс в Daily Note соответствующего дня
		await this.appendToDailyNote(dailyNotePath, remote.title, file.path, blockId, metadata.localCompleted, createdDate);
	}

	private async appendToDailyNote(path: string, title: string, taskFilePath: string, blockId: string, completed: boolean, date: moment.Moment) {
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!file && this.settings.createDailyNoteIfMissing) {
			// Нормализуем путь для создания
			const parts = path.split('/');
			if (parts.length > 1) {
				const folderPath = parts.slice(0, -1).join('/');
				if (!this.app.vault.getAbstractFileByPath(folderPath)) {
					await this.app.vault.createFolder(folderPath);
				}
			}
			file = await this.app.vault.create(path, `# Daily Note ${date.format('YYYY-MM-DD')}\n\n## Tasks\n`);
		}

		if (file instanceof TFile) {
			const status = completed ? 'x' : ' ';
			const line = `\n- [${status}] ${title} [[${taskFilePath}|↗]] ^${blockId}`;
			await this.app.vault.append(file, line);
		}
	}

	private getDailyNotePath(date: moment.Moment): string {
		const folder = this.settings.dailyNoteFolder;
		const fileName = date.format(this.settings.dailyNoteFilenamePattern);
		return normalizePath(`${folder}/${fileName}.md`);
	}

	private getTaskFiles(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(this.settings.taskNotesFolder);
		if (!(folder instanceof TFolder)) return [];
		
		return this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(this.settings.taskNotesFolder));
	}
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}
