// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { renderBox, truncateText, truncateMultilineText } from "./utils.js";
import chalk from "chalk";
import log from "../utils/log.js";
import { getConfig } from "../utils/config.js";
import { calculateReplacement, applyReplacement } from "../runtime/replacement.js";
import { getCommandCacheKey } from "../runtime/parser.js";
import { initializeRuntime } from "../runtime/initialize.js";
const getMaxSuggestions = () => getConfig().maxSuggestions ?? 5;
const suggestionWidth = 40;
const descriptionWidth = 30;
const descriptionHeight = 5;
const borderWidth = 2;
export const getMaxLines = () => borderWidth + Math.max(getMaxSuggestions(), descriptionHeight) + 1; // accounts when there is a unhandled newline at the end of the command
export const MIN_WIDTH = borderWidth + descriptionWidth;
export class SuggestionManager {
    #term;
    #commandKey;
    #activeSuggestionIdx;
    #suggestBlob;
    #shell;
    #hideSuggestions = false;
    #abortController;
    #runtime;
    #requestVersion = 0;
    constructor(terminal, shell, runtime) {
        this.#term = terminal;
        this.#commandKey = "";
        this.#activeSuggestionIdx = 0;
        this.#shell = shell;
        this.#runtime = runtime;
    }
    initialize() {
        this.#runtime ??= initializeRuntime(this.#shell);
        void this.#runtime.catch((e) => log.debug({ msg: "suggestion runtime initialization failed", e: e.message }));
    }
    _getRuntime() {
        this.initialize();
        return this.#runtime;
    }
    invalidate() {
        this.#requestVersion += 1;
        this.#abortController?.abort();
    }
    async suspend() {
        const commandCleared = this.#commandKey.length !== 0 || this.#abortController != null;
        this.invalidate();
        this.#commandKey = "";
        this.#suggestBlob = undefined;
        this.#activeSuggestionIdx = 0;
        this.#hideSuggestions = false;
        if (commandCleared) {
            try {
                const runtime = await this._getRuntime();
                runtime.clearTransientSuggestionState?.();
            }
            catch (e) {
                log.debug({ msg: "failed to clear transient suggestion state", e: e.message });
            }
        }
    }
    async _loadSuggestions() {
        const commandState = this.#term.getCommandState();
        const commandText = commandState.commandText;
        const commandKey = commandText ? `${this.#term.cwd}\u0000${getCommandCacheKey(commandText, this.#shell)}` : "";
        if (commandKey.length !== 0 && commandKey === this.#commandKey && !this.#hideSuggestions && !commandState.hasOutput) {
            return false;
        }
        // Aborting is cooperative; the version check also rejects generators that ignore cancellation.
        const ownVersion = ++this.#requestVersion;
        this.#abortController?.abort();
        if (!commandText) {
            const commandCleared = this.#commandKey.length !== 0;
            this.#commandKey = "";
            if (commandCleared) {
                const runtime = await this._getRuntime();
                runtime.clearTransientSuggestionState?.();
            }
        }
        if (!commandText || this.#hideSuggestions || commandState.hasOutput) {
            const changed = this.#suggestBlob != null || this.#activeSuggestionIdx !== 0;
            this.#suggestBlob = undefined;
            this.#activeSuggestionIdx = 0;
            return changed;
        }
        const abortController = new AbortController();
        this.#abortController = abortController;
        try {
            const { getSuggestions } = await this._getRuntime();
            abortController.signal.throwIfAborted();
            const suggestionBlob = await getSuggestions(commandText, this.#term.cwd, this.#shell, abortController.signal);
            if (abortController.signal.aborted || ownVersion !== this.#requestVersion) {
                return false;
            }
            this.#commandKey = commandKey;
            this.#suggestBlob = suggestionBlob;
            this.#activeSuggestionIdx = 0;
            return true;
        }
        catch (e) {
            if (e instanceof Error && e.name === "AbortError") {
                log.debug({ msg: "suggestion generation aborted", commandText, shell: this.#shell });
                return false;
            }
            throw e;
        }
        finally {
            if (this.#abortController === abortController) {
                this.#abortController = undefined;
            }
        }
    }
    _renderArgumentDescription(description) {
        if (!description)
            return [];
        return renderBox([truncateText(description, descriptionWidth - borderWidth)], descriptionWidth);
    }
    _renderDescription(description) {
        if (!description)
            return "";
        return renderBox(truncateMultilineText(description, descriptionWidth - borderWidth, descriptionHeight), descriptionWidth);
    }
    _renderSuggestions(suggestions, activeSuggestionIdx) {
        return renderBox(suggestions.map((suggestion, idx) => {
            const suggestionText = `${suggestion.icon} ${suggestion.name}`;
            const truncatedSuggestion = truncateText(suggestionText, suggestionWidth - 2);
            return idx == activeSuggestionIdx ? chalk.bgHex(getConfig().activeSuggestionBackgroundColor)(truncatedSuggestion) : truncatedSuggestion;
        }), suggestionWidth);
    }
    _calculatePadding(description, cursorX) {
        const wrappedPadding = cursorX % this.#term.cols;
        const maxPadding = description.length !== 0 ? this.#term.cols - suggestionWidth - descriptionWidth : this.#term.cols - suggestionWidth;
        const swapDescription = wrappedPadding > maxPadding && description.length !== 0;
        const swappedPadding = swapDescription ? Math.max(wrappedPadding - descriptionWidth, 0) : wrappedPadding;
        const padding = Math.min(Math.min(wrappedPadding, swappedPadding), maxPadding);
        return { padding, swapDescription };
    }
    _calculateRowPadding(padding, swapDescription, suggestionContent, descriptionContent) {
        if (swapDescription) {
            return descriptionContent == null ? padding + descriptionWidth : padding;
        }
        return suggestionContent == null ? padding + suggestionWidth : padding;
    }
    async exec() {
        return await this._loadSuggestions();
    }
    render(direction, cursorX) {
        if (!this.#suggestBlob) {
            return [];
        }
        const { suggestions, argumentDescription } = this.#suggestBlob;
        const maxSuggestions = getMaxSuggestions();
        const page = Math.min(Math.floor(this.#activeSuggestionIdx / maxSuggestions) + 1, Math.floor(suggestions.length / maxSuggestions) + 1);
        const pagedSuggestions = suggestions.filter((_, idx) => idx < page * maxSuggestions && idx >= (page - 1) * maxSuggestions);
        const activePagedSuggestionIndex = this.#activeSuggestionIdx % maxSuggestions;
        const activeDescription = pagedSuggestions.at(activePagedSuggestionIndex)?.description || argumentDescription || "";
        const { swapDescription, padding } = this._calculatePadding(activeDescription, cursorX);
        if (suggestions.length <= this.#activeSuggestionIdx) {
            this.#activeSuggestionIdx = Math.max(suggestions.length - 1, 0);
        }
        if (pagedSuggestions.length == 0) {
            if (argumentDescription != null) {
                return this._renderArgumentDescription(argumentDescription).map((row) => ({ startX: padding, length: descriptionWidth, data: row }));
            }
            return [];
        }
        const descriptionUI = this._renderDescription(activeDescription);
        const suggestionUI = this._renderSuggestions(pagedSuggestions, activePagedSuggestionIndex);
        const ui = [];
        const maxRows = Math.max(descriptionUI.length, suggestionUI.length);
        for (let i = 0; i < maxRows; i++) {
            const [suggestionUIRow, descriptionUIRow] = direction == "above"
                ? [suggestionUI[i - maxRows + suggestionUI.length], descriptionUI[i - maxRows + descriptionUI.length]]
                : [suggestionUI[i], descriptionUI[i]];
            const data = swapDescription ? (descriptionUIRow ?? "") + (suggestionUIRow ?? "") : (suggestionUIRow ?? "") + (descriptionUIRow ?? "");
            const rowPadding = this._calculateRowPadding(padding, swapDescription, suggestionUIRow, descriptionUIRow);
            ui.push({
                startX: rowPadding,
                length: (suggestionUIRow == null ? 0 : suggestionWidth) + (descriptionUIRow == null ? 0 : descriptionWidth),
                data: data,
            });
        }
        return ui;
    }
    update(keyPress, allowBindings = true) {
        const { name, shift, ctrl } = keyPress;
        if (name == "return") {
            this.#term.clearCommand(); // clear the current command on enter
        }
        // if suggestions are hidden, keep them hidden until during command navigation
        if (this.#hideSuggestions) {
            this.#hideSuggestions = name == "up" || name == "down";
        }
        if (!allowBindings || !this.#suggestBlob) {
            return false;
        }
        const { dismissSuggestions: { key: dismissKey, shift: dismissShift, control: dismissCtrl }, acceptSuggestion: { key: acceptKey, shift: acceptShift, control: acceptCtrl }, nextSuggestion: { key: nextKey, shift: nextShift, control: nextCtrl }, previousSuggestion: { key: prevKey, shift: prevShift, control: prevCtrl }, } = getConfig().bindings;
        if (name == dismissKey && shift == !!dismissShift && ctrl == !!dismissCtrl) {
            this.#suggestBlob = undefined;
            this.#hideSuggestions = true;
        }
        else if (name == prevKey && shift == !!prevShift && ctrl == !!prevCtrl) {
            this.#activeSuggestionIdx = Math.max(0, this.#activeSuggestionIdx - 1);
        }
        else if (name == nextKey && shift == !!nextShift && ctrl == !!nextCtrl) {
            this.#activeSuggestionIdx = Math.min(this.#activeSuggestionIdx + 1, (this.#suggestBlob?.suggestions.length ?? 1) - 1);
        }
        else if (name == acceptKey && shift == !!acceptShift && ctrl == !!acceptCtrl) {
            const suggestion = this.#suggestBlob?.suggestions.at(this.#activeSuggestionIdx);
            if (suggestion == null || this.#suggestBlob?.suggestions.length == 0) {
                return false;
            }
            const action = calculateReplacement(this.#suggestBlob?.activeToken, suggestion);
            if (action == null) {
                return false;
            }
            this.#term.write(applyReplacement(action));
        }
        else if (name == "return" || (name == "c" && ctrl)) {
            this.#term.clearCommand();
            return false;
        }
        else {
            return false;
        }
        log.debug({ msg: "handled keypress", ...keyPress });
        return true;
    }
}
