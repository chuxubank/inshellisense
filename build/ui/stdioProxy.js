// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import * as ansi from "../utils/ansi.js";
// eslint-disable-next-line no-control-regex
const cursorPositionReport = new RegExp("\\u001B\\[\\??\\d+;\\d+R", "g");
// eslint-disable-next-line no-control-regex
const partialCursorPositionReport = new RegExp("\\u001B\\[\\??\\d*(?:;\\d*)?$");
// eslint-disable-next-line no-control-regex
const terminalColorReport = new RegExp("\\u001B\\](1[012]);[^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)", "g");
// eslint-disable-next-line no-control-regex
const partialTerminalColorReport = new RegExp("\\u001B\\](?:1(?:[012])?)?(?:;[^\\u0007\\u001B]*)?(?:\\u001B)?$");
// blocks win32 input mode, the kitty keyboard protocol and xterm modifyOtherKeys from upgrading input & breaking node's readline
// eslint-disable-next-line no-control-regex
const keyEncodingUpgrade = new RegExp("\\u001B\\[(?:\\?9001([hl])|\\?u|[=><][\\d;]*u|>[\\d;]*m)", "g");
// a trailing portion of a key encoding upgrade
// eslint-disable-next-line no-control-regex
const partialKeyEncodingUpgrade = new RegExp("^\\u001B(?:\\[(?:\\?(?:9(?:0(?:0(?:1)?)?)?)?|[=><][\\d;]*)?)?$");
const carriageReturn = "\r".charCodeAt(0);
const getPartialKeyEncodingUpgrade = (input) => {
    const sequenceStart = input.lastIndexOf("\u001B");
    if (sequenceStart === -1)
        return "";
    const suffix = input.slice(sequenceStart);
    return partialKeyEncodingUpgrade.test(suffix) ? suffix : "";
};
const replaceBareLineFeeds = (output) => {
    let feed = output.indexOf("\n");
    if (feed === -1)
        return output;
    let replaced = "";
    let copiedTo = 0;
    for (; feed !== -1; feed = output.indexOf("\n", feed + 1)) {
        if (output.charCodeAt(feed - 1) === carriageReturn)
            continue;
        replaced += output.slice(copiedTo, feed);
        replaced += ansi.index;
        copiedTo = feed + 1;
    }
    return replaced + output.slice(copiedTo);
};
export class StdioProxy {
    #keypressInput = new PassThrough();
    #decoder = new StringDecoder("utf8");
    #onCursorPositionReport;
    #onTerminalColorReport;
    #onWin32InputMode;
    #pendingInput = "";
    #pendingOutput = "";
    constructor({ onCursorPositionReport = () => { }, onTerminalColorReport = () => { }, onWin32InputMode = () => { } } = {}) {
        this.#onCursorPositionReport = onCursorPositionReport;
        this.#onTerminalColorReport = onTerminalColorReport;
        this.#onWin32InputMode = onWin32InputMode;
        readline.emitKeypressEvents(this.#keypressInput);
    }
    onKeypress(listener) {
        this.#keypressInput.on("keypress", listener);
    }
    handleInput(data) {
        const decoded = Buffer.isBuffer(data) ? this.#decoder.write(data) : this.#decoder.end() + data;
        if (!Buffer.isBuffer(data))
            this.#decoder = new StringDecoder("utf8");
        this.#routeInput(this.#pendingInput + decoded);
    }
    handleOutput(data) {
        const input = this.#pendingOutput + data;
        this.#pendingOutput = getPartialKeyEncodingUpgrade(input);
        const completeInput = this.#pendingOutput.length === 0 ? input : input.slice(0, -this.#pendingOutput.length);
        return replaceBareLineFeeds(completeInput.replace(keyEncodingUpgrade, (_sequence, win32Mode) => {
            if (win32Mode != null)
                this.#onWin32InputMode(win32Mode === "h");
            return "";
        }));
    }
    dispose() {
        const remaining = this.#pendingInput + this.#decoder.end();
        this.#pendingInput = "";
        if (remaining.length !== 0)
            this.#keypressInput.write(remaining);
        this.#keypressInput.destroy();
        const pendingOutput = this.#pendingOutput;
        this.#pendingOutput = "";
        return pendingOutput;
    }
    #routeInput(input) {
        this.#pendingInput = input.match(partialCursorPositionReport)?.[0] ?? input.match(partialTerminalColorReport)?.[0] ?? "";
        const completeInput = this.#pendingInput.length === 0 ? input : input.slice(0, -this.#pendingInput.length);
        const keypressInput = completeInput
            .replace(cursorPositionReport, (response) => {
            this.#onCursorPositionReport(response);
            return "";
        })
            .replace(terminalColorReport, (response, selector) => {
            this.#onTerminalColorReport(Number(selector), response);
            return "";
        });
        if (keypressInput.length !== 0)
            this.#keypressInput.write(keypressInput);
    }
}
