export const GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0';
export const AUTH_REDIRECT_URI = 'obsidian://mstodo-sync-auth';
export const AUTH_TENANT = 'consumers';
export const AUTH_SCOPES = ['Tasks.ReadWrite', 'offline_access'];

export const DEFAULT_SETTINGS: any = {
	taskNotesFolder: 'Tasks/MS-To-Do',
	dailyNoteFolder: 'Daily',
	dailyNoteFilenamePattern: 'YYYY-MM-DD',
	syncTag: '#mstodo',
	defaultTodoListId: '',
	clientId: 'YOUR_CLIENT_ID',
	syncIntervalMinutes: 30,
	conflictStrategy: 'newest-wins',
	createDailyNoteIfMissing: true,
	logLevel: 'info',
	dryRunMode: false,
	deltaToken: '',
	accessToken: '',
	refreshToken: '',
	tokenExpiresAt: 0,
	pkceVerifier: ''
};
