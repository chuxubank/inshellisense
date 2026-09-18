// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { setupZshDotfiles, Shell } from "../utils/shell.js";
let runtimeInitialization;
export const initializeRuntime = (shell) => {
    runtimeInitialization ??= (async () => {
        const zshSetup = shell == Shell.Zsh ? setupZshDotfiles() : Promise.resolve();
        const [runtime, alias] = await Promise.all([import("./runtime.js"), import("./alias.js")]);
        await Promise.all([runtime.loadLocalSpecsSet(), alias.loadAliases(shell), zshSetup]);
        return runtime;
    })();
    return runtimeInitialization;
};
