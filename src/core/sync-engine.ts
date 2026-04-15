import { App, Notice, TFile, moment } from 'obsidian';
import { MsTodoSyncSettings, TaskFrontMatter, GraphTask } from '../interfaces';
import { ObsidianFileManager } from '../obsidian/file-manager';
import { GraphClient } from '../api/graph-client';

export class SyncEngine {
	constructor(
		private app: App,
		private settings: MsTodoSyncSettings,
		private fileManager: ObsidianFileManager,
		private graphClient: GraphClient
	) {}

	async runSync() {
		try {
			if (!this.settings.defaultTodoListId) {
				new Notice('Please select a default Todo List in settings');
				return;
			}

			new Notice('Syncing with Microsoft To Do...');

			// 1. Pre-sync: сканируем локальные изменения в Daily Notes
			await this.preSyncLocalScan();

			// 2. Import: получаем изменения из MS To Do
			await this.importFromRemote();

			// 3. Export: отправляем локальные изменения в MS To Do
			await this.exportToRemote();

			new Notice('Sync completed successfully!');
		} catch (e) {
			console.error('[MsTodoSync] Sync error:', e);
			new Notice(`Sync failed: ${e.message}`);
		}
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

	/**
	 * Импорт изменений из MS To Do (Delta Sync).
	 */
	private async importFromRemote() {
		const result = await this.graphClient.getTasksDelta(this.settings.defaultTodoListId, this.settings.deltaToken);
		
		for (const remoteTask of result.value) {
			const localFile = await this.fileManager.findTaskFileById(remoteTask.id, this.settings.taskNotesFolder);
			const remoteCompleted = remoteTask.status === 'completed';

			if (localFile) {
				const fm = this.app.metadataCache.getFileCache(localFile)?.frontmatter as TaskFrontMatter;
				
				// Проверка конфликта
				const isModifiedLocally = fm.localCompleted !== fm.lastSyncedCompleted;
				const isModifiedRemotely = remoteTask['@odata.etag'] !== fm.msTodoEtag;

				if (isModifiedLocally && isModifiedRemotely) {
					await this.resolveConflict(localFile, fm, remoteTask);
				} else if (isModifiedRemotely) {
					// Просто обновляем локальную версию
					await this.applyRemoteUpdate(localFile, fm, remoteTask);
				}
			} else {
				// Создаем новую задачу локально, если её еще нет
				await this.createNewLocalTask(remoteTask);
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
		for (const file of taskFiles) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as TaskFrontMatter;
			if (!fm || fm.msTodoSyncStatus !== 'pending') continue;

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
			} else {
				// Здесь должна быть логика создания новой задачи в MS To Do из локальной заметки
				// (пока не реализовано в этом прототипе для краткости)
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
			// Бекапим локальную версию перед перезаписью (опционально)
			await this.applyRemoteUpdate(file, fm, remote);
		} else {
			// Локальная версия побеждает — пометим как pending для экспорта
			await this.fileManager.updateTaskMetadata(file, { msTodoSyncStatus: 'pending' });
		}
	}

	private async createNewLocalTask(remote: GraphTask) {
		const blockId = this.fileManager.generateBlockId();
		const dailyNotePath = this.getDailyNotePath(moment()); // Для новых задач берем сегодня
		
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
		
		// Добавляем чекбокс в Daily Note
		await this.appendToDailyNote(dailyNotePath, remote.title, file.path, blockId, metadata.localCompleted);
	}

	private async appendToDailyNote(path: string, title: string, taskFilePath: string, blockId: string, completed: boolean) {
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!file && this.settings.createDailyNoteIfMissing) {
			file = await this.app.vault.create(path, `# Daily Note ${moment().format('YYYY-MM-DD')}\n\n## Tasks\n`);
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
		return this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(this.settings.taskNotesFolder));
	}
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}
