// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import path from "node:path";
import { spawn } from "node:child_process";
import fsAsync from "node:fs/promises";
import { homedir } from "node:os";
import { getPathSeparator, gitBashPath, Shell } from "../utils/shell.js";
import log from "../utils/log.js";
const getExecutionShell = async () => {
    if (process.platform !== "win32")
        return;
    try {
        return await gitBashPath();
    }
    catch (e) {
        log.debug({ msg: "failed to load posix shell for windows child_process.spawn, some generators might fail", error: e });
    }
};
const bashSpecialCharacters = /[&|<>\s]/g;
// escape whitespace & special characters in an argument when not quoted
const shouldEscapeArg = (arg) => {
    const hasSpecialCharacter = bashSpecialCharacters.test(arg);
    const isSingleCharacter = arg.length === 1;
    return hasSpecialCharacter && !isSingleCharacter && !isQuoted(arg, `"`);
};
/* based on libuv process.c used by nodejs, only quotes are escaped for shells. if using git bash need to escape whitespace & special characters in an argument */
const escapeArgs = (shell, args) => {
    // only escape args for git bash
    if (process.platform !== "win32" || shell == undefined)
        return args;
    return args.map((arg) => (shouldEscapeArg(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg));
};
const isQuoted = (value, quoteChar) => (value?.startsWith(quoteChar) && value?.endsWith(quoteChar)) ?? false;
const quoteString = (value, quoteChar) => {
    if (isQuoted(value, quoteChar))
        return value;
    const escapedValue = value.replaceAll(`\\${quoteChar}`, quoteChar).replaceAll(quoteChar, `\\${quoteChar}`);
    return `${quoteChar}${escapedValue}${quoteChar}`;
};
const needsQuoted = (value, quoteChar) => isQuoted(value, quoteChar) || value.includes(" ");
const getShellQuoteChar = (shell) => {
    switch (shell) {
        case Shell.Zsh:
        case Shell.Bash:
        case Shell.Fish:
            return `"`;
        case Shell.Xonsh:
            return `'`;
        case Shell.Nushell:
            return "`";
        case Shell.Pwsh:
        case Shell.Powershell:
            return `'`;
        case Shell.Cmd:
            return `"`;
    }
};
export const getShellWhitespaceEscapeChar = (shell) => {
    switch (shell) {
        case Shell.Zsh:
        case Shell.Bash:
        case Shell.Fish:
        case Shell.Xonsh:
        case Shell.Nushell:
            return "\\";
        case Shell.Pwsh:
        case Shell.Powershell:
            return "`";
        case Shell.Cmd:
            return "^";
    }
};
export const escapePath = (value, shell) => value != null && needsQuoted(value, getShellQuoteChar(shell)) ? quoteString(value, getShellQuoteChar(shell)) : value;
export const buildExecuteShellCommand = (timeout, signal) => async ({ command, env, args, cwd }) => {
    signal?.throwIfAborted();
    const executionShell = await getExecutionShell();
    const escapedArgs = escapeArgs(executionShell, args);
    const child = spawn(command, escapedArgs, { cwd, env: { ...process.env, ...env, ISTERM: "1" }, shell: executionShell, signal });
    const killTimeout = setTimeout(() => child.kill("SIGKILL"), timeout);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", (err) => {
        log.debug({ msg: "shell command failed", command, args, e: err.message });
    });
    return new Promise((resolve) => {
        child.on("close", (code) => {
            clearTimeout(killTimeout);
            resolve({
                status: code ?? 0,
                stderr,
                stdout,
            });
        });
    });
};
const isHomedir = (path) => path.startsWith("~");
export const resolveCwd = async (cmdToken, cwd, shell, signal) => {
    if (cmdToken == null || cmdToken.complete)
        return { cwd, pathy: false, complete: false };
    const { token: rawToken, isQuoted } = cmdToken;
    const sep = getPathSeparator(shell);
    const escapedToken = !isQuoted ? rawToken.replaceAll(" ", "\\ ") : rawToken;
    if (escapedToken === "~")
        return { cwd: homedir(), pathy: true, complete: false };
    if (escapedToken === `~${sep}`)
        return { cwd: homedir(), pathy: true, complete: true };
    if (!escapedToken.includes(sep))
        return { cwd, pathy: false, complete: false };
    const tokenComplete = escapedToken.endsWith(sep);
    const trimmedToken = escapedToken.endsWith(sep) ? escapedToken : path.dirname(escapedToken);
    const token = trimmedToken;
    const resolvedCwd = path.isAbsolute(token) ? token : isHomedir(token) ? token.replace("~", homedir()) : path.join(cwd, token);
    try {
        signal?.throwIfAborted();
        await fsAsync.access(resolvedCwd, fsAsync.constants.R_OK);
        return { cwd: resolvedCwd, pathy: true, complete: tokenComplete };
    }
    catch {
        // fallback to the parent folder if possible
        const baselessCwd = resolvedCwd.substring(0, resolvedCwd.length - path.basename(resolvedCwd).length);
        try {
            signal?.throwIfAborted();
            await fsAsync.access(baselessCwd, fsAsync.constants.R_OK);
            return { cwd: baselessCwd, pathy: true, complete: tokenComplete };
        }
        catch {
            /*empty*/
        }
        return { cwd, pathy: false, complete: false };
    }
};
