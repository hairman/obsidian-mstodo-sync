import { requestUrl } from 'obsidian';
import { AuthManager } from '../auth/auth-manager';
import { GRAPH_ENDPOINT } from '../constants';
import { GraphTask } from '../interfaces';

export class GraphClient {
	constructor(private auth: AuthManager) {}

	/**
	 * Обертка над requestUrl с автоматической подстановкой токена.
	 */
	private async request(url: string, method: string = 'GET', body?: any) {
		const token = await this.auth.getAccessToken();
		if (!token) throw new Error('Not authenticated');

		const response = await requestUrl({
			url: url.startsWith('http') ? url : `${GRAPH_ENDPOINT}${url}`,
			method,
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Prefer': 'outlook.body-content-type="text"'
			},
			body: body ? JSON.stringify(body) : undefined
		});

		if (response.status === 401) {
			// В теории getAccessToken должен был обновить токен, 
			// но если мы здесь, значит сессия совсем мертва.
			throw new Error('Authentication expired');
		}

		return response;
	}

	async getTodoLists() {
		const res = await this.request('/me/todo/lists');
		return res.json.value;
	}

	/**
	 * Получение задач с поддержкой Delta Sync
	 */
	async getTasksDelta(listId: string, deltaToken?: string) {
		let url = `/me/todo/lists/${listId}/tasks/delta`;
		if (deltaToken) {
			url += `?$deltatoken=${deltaToken}`;
		}
		
		const res = await this.request(url);
		return {
			value: res.json.value as GraphTask[],
			deltaToken: res.json['@odata.deltaLink']?.split('deltatoken=')[1]
		};
	}

	async createTask(listId: string, title: string, bodyContent?: string) {
		const body = {
			title,
			body: bodyContent ? {
				content: bodyContent,
				contentType: 'text'
			} : undefined
		};
		const res = await this.request(`/me/todo/lists/${listId}/tasks`, 'POST', body);
		return res.json as GraphTask;
	}

	async updateTask(listId: string, taskId: string, updates: Partial<GraphTask>) {
		const res = await this.request(`/me/todo/lists/${listId}/tasks/${taskId}`, 'PATCH', updates);
		return res.json as GraphTask;
	}

	async getTask(listId: string, taskId: string) {
		const res = await this.request(`/me/todo/lists/${listId}/tasks/${taskId}`);
		return res.json as GraphTask;
	}
}
