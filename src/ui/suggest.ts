import { AbstractInputSuggest, App, TFile, TFolder, TAbstractFile } from 'obsidian';

export class FileSuggest extends AbstractInputSuggest<TFile> {
	private inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(inputStr: string): TFile[] {
		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const files: TFile[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		abstractFiles.forEach((file: TAbstractFile) => {
			if (file instanceof TFile && file.extension === 'md' && file.path.toLowerCase().includes(lowerCaseInputStr)) {
				files.push(file);
			}
		});

		return files;
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		console.debug(`[MsTodoSync] Selecting file: ${file.path}`);
		if (this.inputEl) {
			this.inputEl.value = file.path;
			this.inputEl.dispatchEvent(new Event('input'));
			this.close();
		} else {
			console.error(`[MsTodoSync] inputEl is undefined in FileSuggest!`);
		}
	}
}

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(inputStr: string): TFolder[] {
		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const folders: TFolder[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		abstractFiles.forEach((file: TAbstractFile) => {
			if (file instanceof TFolder && file.path.toLowerCase().includes(lowerCaseInputStr)) {
				folders.push(file);
			}
		});

		return folders;
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		console.debug(`[MsTodoSync] Selecting folder: ${folder.path}`);
		if (this.inputEl) {
			this.inputEl.value = folder.path;
			this.inputEl.dispatchEvent(new Event('input'));
			this.close();
		} else {
			console.error(`[MsTodoSync] inputEl is undefined in FolderSuggest!`);
		}
	}
}
