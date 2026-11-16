import { useEffect, useState, useSyncExternalStore } from 'react';

/** A tiny observable value for state shared between the imperative engine code and React. */
export class Store<T> {
	private listeners = new Set<() => void>();

	constructor(private value: T) {}

	get(): T {
		return this.value;
	}

	set(next: T): void {
		if (next === this.value) {
			return;
		}
		this.value = next;
		this.listeners.forEach((listener) => listener());
	}

	update(patch: Partial<T>): void {
		this.set({ ...this.value, ...patch });
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
}

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, () => store.get());

/** Re-renders the caller every `ms`, for views of fast-changing imperative state (metrics). */
export const useTicker = (ms: number): number => {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((value) => value + 1), ms);
		return () => clearInterval(id);
	}, [ms]);
	return tick;
};
