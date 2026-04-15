export interface MsTodoSyncSettings {
	taskNotesFolder: string;
	dailyNoteFolder: string;
	dailyNoteFilenamePattern: string;
	syncTag: string;
	defaultTodoListId: string;
	clientId: string;
	syncIntervalMinutes: number;
	conflictStrategy: 'remote-wins' | 'local-wins' | 'newest-wins';
	createDailyNoteIfMissing: boolean;
	logLevel: 'debug' | 'info' | 'warn' | 'error';
	dryRunMode: boolean;
	deltaToken: string;
	
	// Auth storage
	accessToken?: string;
	refreshToken?: string;
	tokenExpiresAt: number;
	pkceVerifier?: string;
}

export interface TaskFrontMatter {
	msTodoId: string;
	msTodoListId: string;
	msTodoEtag: string;
	msTodoLastModifiedDateTime: string;
	msTodoSyncStatus: 'synced' | 'pending' | 'conflict';
	sourceDailyNotePath: string;
	sourceBlockId: string;
	syncTag: string;
	localCompleted: boolean;
	lastSyncedCompleted: boolean;
	localUpdatedAt: number;
}

export interface GraphTask {
	id: string;
	title: string;
	status: 'notStarted' | 'completed' | 'deleted';
	lastModifiedDateTime: string;
	createdDateTime: string;
	body?: {
		content: string;
		contentType: 'text' | 'html';
	};
	'@odata.etag': string;
}

export interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope: string;
}
