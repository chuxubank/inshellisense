// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import ansi from "ansi-escapes";
import { eraseViewport, shouldFallbackToDec } from "../utils/ansi.js";
import * as dec from "../utils/dec.js";
import { endTiming, startTiming } from "../utils/performance.js";
import { getMaxLines } from "./suggestionManager.js";
export class SuggestionRenderer {
    #term;
    #suggestions;
    #writeOutput;
    #cursorPositionSequences;
    #cache = {};
    #visible = false;
    #direction;
    #skipNextPtyRender = false;
    #resizeRepaint;
    #resizePending = false;
    constructor(term, suggestions, writeOutput) {
        this.#term = term;
        this.#suggestions = suggestions;
        this.#writeOutput = writeOutput;
        this.#cursorPositionSequences = shouldFallbackToDec() ? dec : ansi;
        this.#direction = this.#snapshot().layout.direction;
    }
    get hasVisibleSuggestions() {
        return this.#visible;
    }
    async handleBufferChange(bufferType) {
        if (bufferType === "alternate") {
            this.#clearNormalBufferSuggestions();
            await this.#suggestions.suspend();
            this.#visible = false;
        }
        else {
            this.#skipNextPtyRender = true;
            this.#direction = this.#snapshot().layout.direction;
            if (this.#resizePending)
                this.#scheduleResizeRepaint();
        }
        this.#resetCache();
    }
    renderPtyData(data, preserveDuringBackspaceEcho) {
        if (this.#term.isAlternateBuffer()) {
            this.#writeOutput(data);
            return;
        }
        if (this.#resizeRepaint != null) {
            this.#writeOutput(data);
            this.#scheduleResizeRepaint();
            return;
        }
        const snapshot = this.#snapshot();
        if (this.#skipNextPtyRender) {
            this.#writeOutput(data);
            this.#skipNextPtyRender = false;
            this.#cache.patch = undefined;
            return;
        }
        // inline redrawing apps (ink based clis, progress bars, etc.) flip the direction on every frame, so only clear when a suggestion is rendered
        if (this.#visible && this.#direction !== snapshot.layout.direction) {
            this.#clearPreviousDirection(snapshot);
        }
        this.#render(data, preserveDuringBackspaceEcho, snapshot);
    }
    renderSuggestionUpdate(preserveDuringBackspaceEcho) {
        if (this.#term.isAlternateBuffer() || this.#resizeRepaint != null)
            return;
        this.#render("", preserveDuringBackspaceEcho, this.#snapshot());
    }
    resize(columns, rows) {
        this.#resizePending = true;
        this.#resetCache();
        this.#visible = false;
        this.#term.resize(columns, rows);
        this.#scheduleResizeRepaint();
    }
    #layout(cursor) {
        const maxLines = getMaxLines();
        const { remainingLines, cursorY } = cursor;
        const direction = remainingLines >= maxLines ? "below" : cursorY >= maxLines ? "above" : remainingLines >= cursorY ? "below" : "above";
        const lines = direction === "above" ? Math.min(maxLines, cursorY) : Math.min(maxLines, remainingLines);
        return { direction, lines };
    }
    #snapshot(bufferType = "active") {
        const cursor = this.#term.getCursorState(bufferType);
        return {
            cursor,
            command: this.#term.getCommandState(),
            layout: this.#layout(cursor),
        };
    }
    #render(data, preserveDuringBackspaceEcho, snapshot) {
        const renderTiming = startTiming();
        try {
            const previouslyVisible = this.#visible;
            const { layout: { direction, lines }, cursor: { hidden: cursorHidden, shift: cursorShift, cursorX }, command, } = snapshot;
            const suggestions = this.#suggestions.render(direction, cursorX);
            const fitsViewport = suggestions.length <= lines && suggestions.every(({ startX, length }) => startX >= 0 && startX + length <= this.#term.cols);
            if (!fitsViewport || (!previouslyVisible && suggestions.length === 0)) {
                if (previouslyVisible && this.#cache.clear != null) {
                    this.#writeOutput(this.#cache.clear);
                }
                this.#cache.patch = "none";
                this.#cache.clear = undefined;
                this.#writeOutput(data);
                this.#visible = false;
                this.#direction = direction;
                return;
            }
            const cursorTerminated = preserveDuringBackspaceEcho || command.cursorTerminated === true;
            const showSuggestions = suggestions.length !== 0 && fitsViewport && cursorTerminated && !command.hasOutput && !cursorShift && !!command.commandText;
            const visibleSuggestions = showSuggestions ? suggestions : [];
            const renderKey = `${direction}:${lines}:${cursorHidden}:${visibleSuggestions
                .map(({ startX, length, data: patchData }) => `${startX}:${length}:${patchData}`)
                .join("\u0000")}`;
            if (data.length === 0 && previouslyVisible === showSuggestions && this.#cache.patch === renderKey) {
                this.#visible = showSuggestions;
                this.#direction = direction;
                return;
            }
            const patch = this.#term.getPatch(lines, visibleSuggestions, direction);
            this.#writeOutput(this.#renderOutput(data, patch, snapshot));
            this.#cache.patch = renderKey;
            this.#cache.clear = showSuggestions ? this.#clearOutput(direction, snapshot) : undefined;
            this.#visible = showSuggestions;
            this.#direction = direction;
        }
        finally {
            endTiming("ui.render", renderTiming);
        }
    }
    #renderOutput(data, patch, snapshot) {
        const { layout: { direction, lines }, cursor: { hidden: cursorHidden }, } = snapshot;
        const showCursor = cursorHidden ? "" : ansi.cursorShow;
        const { cursorSavePosition, cursorRestorePosition } = this.#cursorPositionSequences;
        if (direction === "above") {
            return data + ansi.cursorHide + cursorSavePosition + ansi.cursorPrevLine.repeat(lines) + patch + cursorRestorePosition + showCursor;
        }
        return ansi.cursorHide + cursorSavePosition + ansi.cursorNextLine + patch + cursorRestorePosition + showCursor + data;
    }
    #clearOutput(direction, snapshot, bufferType = "active") {
        const { cursor: { hidden: cursorHidden, cursorY, remainingLines }, } = snapshot;
        const lines = direction === "above" ? Math.min(getMaxLines(), cursorY) : Math.min(getMaxLines(), remainingLines);
        const patch = this.#term.getPatch(lines, [], direction, bufferType);
        const showCursor = cursorHidden ? "" : ansi.cursorShow;
        const { cursorSavePosition, cursorRestorePosition } = this.#cursorPositionSequences;
        if (direction === "above") {
            return ansi.cursorHide + cursorSavePosition + ansi.cursorPrevLine.repeat(lines) + patch + cursorRestorePosition + showCursor;
        }
        return ansi.cursorHide + cursorSavePosition + ansi.cursorNextLine + patch + cursorRestorePosition + showCursor;
    }
    #clearPreviousDirection(snapshot) {
        const previousDirection = snapshot.layout.direction === "above" ? "below" : "above";
        this.#writeOutput(this.#clearOutput(previousDirection, snapshot));
        this.#resetCache();
    }
    #clearNormalBufferSuggestions() {
        if (!this.#visible)
            return;
        const clearOutput = this.#cache.clear ?? this.#clearOutput(this.#direction, this.#snapshot("normal"), "normal");
        this.#writeOutput(clearOutput);
    }
    #resetCache() {
        this.#cache.patch = undefined;
        this.#cache.clear = undefined;
    }
    #scheduleResizeRepaint() {
        if (this.#resizeRepaint != null)
            clearTimeout(this.#resizeRepaint);
        this.#resizeRepaint = setTimeout(() => {
            this.#resizeRepaint = undefined;
            if (this.#term.isAlternateBuffer())
                return;
            this.#resizePending = false;
            const snapshot = this.#snapshot();
            this.#repaintViewport(snapshot);
            this.#render("", false, snapshot);
        }, 150);
    }
    #repaintViewport(snapshot) {
        const cursor = ansi.cursorTo(snapshot.cursor.cursorX, snapshot.cursor.cursorY);
        const showCursor = snapshot.cursor.hidden ? ansi.cursorHide : ansi.cursorShow;
        this.#writeOutput(ansi.cursorHide + eraseViewport + ansi.cursorTo(0, 0) + this.#term.getViewportPatch() + cursor + showCursor);
    }
}
