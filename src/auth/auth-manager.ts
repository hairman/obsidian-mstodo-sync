import { App, Notice, requestUrl } from 'obsidian';
import { MsTodoSyncSettings, TokenResponse } from '../interfaces';
import { AUTH_REDIRECT_URI, AUTH_SCOPES, AUTH_TENANT } from '../constants';

export class AuthManager {
	constructor(private app: App, private settings: MsTodoSyncSettings) {}

	/**
	 * Получение валидного Access Token. Если истек — попытка обновления.
	 */
	async getAccessToken(): Promise<string | null> {
		const now = Date.now();
		const expiresAt = this.settings.tokenExpiresAt;

		// Если токен еще валиден (с запасом 5 минут)
		if (expiresAt && expiresAt - now > 5 * 60 * 1000) {
			return (this.app as any).secretStorage.get(this.settings.accessTokenSecretName);
		}

		// Если токен истек, пробуем обновить через Refresh Token
		const refreshToken = (this.app as any).secretStorage.get(this.settings.refreshTokenSecretName);
		if (refreshToken) {
			try {
				const tokens = await this.refreshAccessToken(refreshToken);
				await this.storeTokens(tokens);
				return tokens.access_token;
			} catch (e) {
				console.error('[MsTodoSync] Failed to refresh token:', e);
				new Notice('Microsoft session expired. Please login again.');
				return null;
			}
		}

		return null;
	}

	async generateAuthUrl(verifier: string): Promise<string> {
		const challenge = await this.generateCodeChallenge(verifier);
		const params = new URLSearchParams({
			client_id: this.settings.clientId,
			response_type: 'code',
			redirect_uri: AUTH_REDIRECT_URI,
			response_mode: 'query',
			scope: AUTH_SCOPES.join(' '),
			code_challenge: challenge,
			code_challenge_method: 'S256'
		});
		return `https://login.microsoftonline.com/${AUTH_TENANT}/oauth2/v2.0/authorize?${params.toString()}`;
	}

	async exchangeCodeForToken(code: string, verifier: string): Promise<void> {
		const body = new URLSearchParams({
			client_id: this.settings.clientId,
			scope: AUTH_SCOPES.join(' '),
			code: code,
			redirect_uri: AUTH_REDIRECT_URI,
			grant_type: 'authorization_code',
			code_verifier: verifier
		});

		const response = await requestUrl({
			url: `https://login.microsoftonline.com/${AUTH_TENANT}/oauth2/v2.0/token`,
			method: 'POST',
			contentType: 'application/x-www-form-urlencoded',
			body: body.toString()
		});

		if (response.status !== 200) {
			throw new Error(`Failed to exchange code: ${response.text}`);
		}

		await this.storeTokens(response.json as TokenResponse);
	}

	private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
		const body = new URLSearchParams({
			client_id: this.settings.clientId,
			scope: AUTH_SCOPES.join(' '),
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		});

		const response = await requestUrl({
			url: `https://login.microsoftonline.com/${AUTH_TENANT}/oauth2/v2.0/token`,
			method: 'POST',
			contentType: 'application/x-www-form-urlencoded',
			body: body.toString()
		});

		if (response.status !== 200) {
			throw new Error(`Failed to refresh token: ${response.text}`);
		}

		return response.json as TokenResponse;
	}

	private async storeTokens(tokens: TokenResponse): Promise<void> {
		(this.app as any).secretStorage.set(this.settings.accessTokenSecretName, tokens.access_token);
		if (tokens.refresh_token) {
			(this.app as any).secretStorage.set(this.settings.refreshTokenSecretName, tokens.refresh_token);
		}
		this.settings.tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
		// saveSettings() будет вызван в main.ts после вызова этой функции
	}


	// PKCE Helpers
	async generateCodeChallenge(verifier: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(verifier);
		const hash = await crypto.subtle.digest('SHA-256', data);
		return this.base64UrlEncode(new Uint8Array(hash));
	}

	generateVerifier(): string {
		const array = new Uint8Array(32);
		crypto.getRandomValues(array);
		return this.base64UrlEncode(array);
	}

	private base64UrlEncode(array: Uint8Array): string {
		let str = '';
		for (const b of array) {
			str += String.fromCharCode(b);
		}
		return btoa(str)
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	}
}
