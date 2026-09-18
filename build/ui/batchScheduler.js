// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
export class BatchScheduler {
    #pending = false;
    #running = false;
    #scheduled = false;
    #task;
    #onError;
    constructor(task, onError) {
        this.#task = task;
        this.#onError = onError;
    }
    request() {
        this.#pending = true;
        if (this.#running || this.#scheduled)
            return;
        this.#scheduled = true;
        queueMicrotask(() => {
            this.#scheduled = false;
            void this.#drain();
        });
    }
    async #drain() {
        this.#running = true;
        try {
            while (this.#pending) {
                this.#pending = false;
                try {
                    await this.#task();
                }
                catch (error) {
                    this.#onError(error);
                }
            }
        }
        finally {
            this.#running = false;
        }
    }
}
