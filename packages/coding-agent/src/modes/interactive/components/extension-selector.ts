/**
 * Generic selector component for extensions.
 * Displays a list of string options with keyboard navigation.
 */

import { Container, getKeybindings, Spacer, Text, type TUI } from "@dyyz1993/pi-tui";
import { theme } from "../theme/theme.js";
import { CountdownTimer } from "./countdown-timer.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint, rawKeyHint } from "./keybinding-hints.js";

export interface ExtensionSelectorOptions {
	tui?: TUI;
	timeout?: number;
	multiple?: boolean;
}

export class ExtensionSelectorComponent extends Container {
	private options: string[];
	private selectedIndex = 0;
	private checkedIndices: Set<number>;
	private multiple: boolean;
	private listContainer: Container;
	private onSelectCallback: (option: string | string[]) => void;
	private onCancelCallback: () => void;
	private titleText: Text;
	private baseTitle: string;
	private countdown: CountdownTimer | undefined;

	constructor(
		title: string,
		options: string[],
		onSelect: (option: string | string[]) => void,
		onCancel: () => void,
		opts?: ExtensionSelectorOptions,
	) {
		super();

		this.options = options;
		this.multiple = opts?.multiple ?? false;
		this.checkedIndices = new Set();
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.baseTitle = title;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.titleText = new Text(theme.fg("accent", title), 1, 0);
		this.addChild(this.titleText);
		this.addChild(new Spacer(1));

		if (opts?.timeout && opts.timeout > 0 && opts.tui) {
			this.countdown = new CountdownTimer(
				opts.timeout,
				opts.tui,
				(s) => this.titleText.setText(theme.fg("accent", `${this.baseTitle} (${s}s)`)),
				() => this.onCancelCallback(),
			);
		}

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		if (this.multiple) {
			this.addChild(
				new Text(
					rawKeyHint("↑↓", "navigate") +
						"  " +
						rawKeyHint("Space", "toggle") +
						"  " +
						keyHint("tui.select.confirm", "confirm") +
						"  " +
						keyHint("tui.select.cancel", "cancel"),
					1,
					0,
				),
			);
		} else {
			this.addChild(
				new Text(
					rawKeyHint("↑↓", "navigate") +
						"  " +
						keyHint("tui.select.confirm", "select") +
						"  " +
						keyHint("tui.select.cancel", "cancel"),
					1,
					0,
				),
			);
		}
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.options.length; i++) {
			const isCursor = i === this.selectedIndex;
			if (this.multiple) {
				const isChecked = this.checkedIndices.has(i);
				const checkbox = isChecked ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
				const label = isCursor
					? theme.fg("accent", `→ ${checkbox} ${this.options[i]}`)
					: `  ${checkbox} ${theme.fg("text", this.options[i])}`;
				this.listContainer.addChild(new Text(label, 1, 0));
			} else {
				const text = isCursor
					? theme.fg("accent", "→ ") + theme.fg("accent", this.options[i])
					: `  ${theme.fg("text", this.options[i])}`;
				this.listContainer.addChild(new Text(text, 1, 0));
			}
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (this.multiple && keyData === " ") {
			if (this.checkedIndices.has(this.selectedIndex)) {
				this.checkedIndices.delete(this.selectedIndex);
			} else {
				this.checkedIndices.add(this.selectedIndex);
			}
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			if (this.multiple) {
				const selected = Array.from(this.checkedIndices)
					.sort()
					.map((i) => this.options[i]);
				this.onSelectCallback(selected);
			} else {
				const selected = this.options[this.selectedIndex];
				if (selected) this.onSelectCallback(selected);
			}
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
	}

	dispose(): void {
		this.countdown?.dispose();
	}
}
