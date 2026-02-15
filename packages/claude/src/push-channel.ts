export class PushChannel<T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiting: ((value: IteratorResult<T>) => void) | null = null;
	private closed = false;

	push(value: T): void {
		if (this.closed) return;

		if (this.waiting) {
			const resolve = this.waiting;
			this.waiting = null;
			resolve({ value, done: false });
		} else {
			this.queue.push(value);
		}
	}

	close(): void {
		this.closed = true;
		if (this.waiting) {
			const resolve = this.waiting;
			this.waiting = null;
			resolve({ value: undefined as T, done: true });
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: (): Promise<IteratorResult<T>> => {
				if (this.queue.length > 0) {
					return Promise.resolve({
						value: this.queue.shift() as T,
						done: false,
					});
				}

				if (this.closed) {
					return Promise.resolve({
						value: undefined as T,
						done: true,
					});
				}

				return new Promise((resolve) => {
					this.waiting = resolve;
				});
			},
		};
	}
}
