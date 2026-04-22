import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { TaskFrontMatter } from '../interfaces';

export class ObsidianFileManager {
	constructor(private app: App) {}

	/**
	 * Безопасное обновление метаданных файла через официальный API.
	 */
	async updateTaskMetadata(file: TFile, updates: Partial<TaskFrontMatter>) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			for (const [key, value] of Object.entries(updates)) {
				fm[key] = value;
			}
		});
	}

	/**
	 * Создание папки, если она не существует.
	 */
	async ensureFolder(folderPath: string) {
		const normalizedPath = normalizePath(folderPath);
		const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!folder) {
			await this.app.vault.createFolder(normalizedPath);
		} else if (!(folder instanceof TFolder)) {
			throw new Error(`Path ${folderPath} exists but is not a folder`);
		}
	}

	/**
	 * Поиск заметки-задачи по msTodoId.
	 */
	findTaskFileById(msTodoId: string, folderPath: string): TFile | null {
		const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath));
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter?.msTodoId === msTodoId) {
				return file;
			}
		}
		return null;
	}

	/**
	 * Синхронизация состояния чекбокса в Daily Note по Block ID.
	 */
	async updateDailyNoteCheckbox(dailyNotePath: string, blockId: string, completed: boolean): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const blockRegex = new RegExp(`\\^${blockId}$`);
			
			const lineIndex = lines.findIndex(line => blockRegex.test(line));
			if (lineIndex !== -1) {
				const statusChar = completed ? 'x' : ' ';
				// Заменяем статус в строке вида "- [ ] Текст [[Link]] ^id"
				lines[lineIndex] = lines[lineIndex].replace(/- \[[ xX]\]/, `- [${statusChar}]`);
				return lines.join('\n');
			}
			return content;
		});
	}

	/**
	 * Генерация уникального Block ID для Obsidian.
	 */
	generateBlockId(): string {
		return `ms-task-${Math.random().toString(36).substring(2, 10)}`;
	}

	/**
	 * Санитизация имени файла.
	 */
	sanitizeFileName(name: string): string {
		return name.replace(/[\\/:*?"<>|]/g, '-').substring(0, 200);
	}

	/**
	 * Создание новой заметки-задачи.
	 */
	async createTaskFile(folder: string, title: string, metadata: TaskFrontMatter): Promise<TFile> {
		await this.ensureFolder(folder);
		const baseName = this.sanitizeFileName(title);
		let fileName = `${baseName}.md`;
		let path = normalizePath(`${folder}/${fileName}`);
		
		// Обработка коллизий имен файлов
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			fileName = `${baseName} (${counter++}).md`;
			path = normalizePath(`${folder}/${fileName}`);
		}

		const content = `\n# ${title}\n\nSynced from Microsoft To Do.\n`;
		const file = await this.app.vault.create(path, content);
		
		// Записываем фронтматтер отдельно для чистоты
		await this.updateTaskMetadata(file, metadata);
		return file;
	}
}
