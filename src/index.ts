import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { BackTracker } from "backtracker";

const placeHolderKey = "__heatsync_default__";
const selfReloadError = "Do not attempt to re-require Heatsync. If you REALLY want to, do it yourself with require.cache and deal with possibly ticking timers and event listeners, but don't complain if something breaks :(";

class Sync {
	/**
	 * An EventEmitter which emits absolute reloaded file paths.
	 */
	public events: EventEmitter = new EventEmitter();
	/**
	 * A Map keyed by absolute file paths which details listeners added to a target.
	 */
	private _listeners: Map<string, Array<[EventEmitter, string, (...args: Array<any>) => any]>> = new Map();
	/**
	 * A Map keyed by absolute file paths which holds references to imports.
	 */
	private _references: Map<string, any> = new Map();
	/**
	 * A Map keyed by absolute file paths which are being watched by heatsync.
	 */
	private _watchers: Map<string, import("fs").FSWatcher> = new Map();

	public constructor() {
		this.events.on("any", (filename: string) => {
			const listeners = this._listeners.get(filename);
			if (!listeners) return;

			for (const [target, event, func] of listeners) {
				target.removeListener(event, func);
			}
		});
	}

	/**
	 * The return value is any, because TypeScript doesn't like dynamically typed return values for import.
	 * It expects a string literal. Cannot be a Generic extending "" either.
	 * You will have to type the return value yourself if typings are important to you.
	 */
	public require(id: string): any;
	public require(id: Array<string>): any;
	public require(id: string, _from: string): any;
	public require(id: string | Array<string>, _from?: string): any {
		let from: string;
		from = _from ? _from : BackTracker.stack.first().dir;
		if (Array.isArray(id)) return id.map(item => this.require(item, from));
		const directory = !path.isAbsolute(id) ? require.resolve(path.join(from, id)) : require.resolve(id);
		if (directory === __filename) throw new Error(selfReloadError);
		const req = require(directory);
		let value: any;
		if (typeof req !== "object" || Array.isArray(req)) {
			value = {};
			Object.defineProperty(value, placeHolderKey, { value: req })
		} else value = req;

		const oldObject = this._references.get(directory);
		if (!oldObject) {
			this._references.set(directory, value);
			let previousModifyTime = 0;
			this._watchers.set(directory, fs.watch(directory, () => {
				delete require.cache[directory];
				try {
					const stat = fs.statSync(directory);
					if (previousModifyTime === stat.mtime.getTime()) return;
					previousModifyTime = stat.mtime.getTime();
					this.require(directory);
				} catch (e) {
					return this.events.emit("error", e);
				}
				this.events.emit(directory);
				this.events.emit("any", directory);
			}));
		} else {
			for (const key of Object.keys(oldObject)) {
				if (key === placeHolderKey) continue
				if (!value[key]) delete oldObject[key];
			}
			Object.assign(oldObject, value);
		}

		const ref = this._references.get(directory);
		if (!ref) return {}
		else return ref[placeHolderKey] ? ref[placeHolderKey] : ref
	}

	public addTemporaryListener<Target extends EventEmitter>(target: Target, event: Parameters<Target["on"]>[0], callback: (...args: Array<any>) => any, method: "on" | "once" = "on") {
		const first = BackTracker.stack.first();
		const absolute = path.normalize(`${first.dir}/${first.filename}`);
		if (!this._listeners.get(absolute)) this._listeners.set(absolute, []);
		this._listeners.get(absolute)!.push([target, event as string, callback]);
		setImmediate(() => target[method](event, callback))
		return target
	}

	public resync(id: string): any;
	public resync(id: Array<string>): any;
	public resync(id: string, _from?: string): any;
	public resync(id: string, _from?: string): any;
	public resync(id: string | Array<string>, _from?: string): any {
		let from: string;
		if (typeof id === "string" && !id.startsWith(".")) from = require.resolve(id);
		else from = _from ? _from : BackTracker.stack.first().dir;
		if (Array.isArray(id)) return id.map(item => this.resync(item, from));
		const directory = !path.isAbsolute(id) ? require.resolve(path.join(from, id)) : require.resolve(id);
		if (directory === __filename) throw new Error(selfReloadError);
		delete require.cache[directory];
		return this.require(directory);
	}
}

export = Sync;
