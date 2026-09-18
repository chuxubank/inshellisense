// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { runTemplates } from "./template.js";
import { buildExecuteShellCommand } from "./utils.js";
import { endTiming, startTiming } from "../utils/performance.js";
const getGeneratorContext = (cwd) => {
    return {
        environmentVariables: Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] != null)),
        currentWorkingDirectory: cwd,
        currentProcess: "",
        sshPrefix: "",
        isDangerous: false,
        searchTerm: "", // TODO: define search term
    };
};
export const executeGenerator = async (generator, tokens, cwd, signal) => {
    const generatorTiming = startTiming();
    try {
        signal?.throwIfAborted();
        const { script, postProcess, scriptTimeout, splitOn, custom, template, filterTemplateSuggestions } = generator;
        const executeShellCommand = buildExecuteShellCommand(scriptTimeout ?? 5000, signal);
        const suggestions = [];
        if (script) {
            const shellInput = typeof script === "function" ? script(tokens) : script;
            const scriptOutput = Array.isArray(shellInput)
                ? await executeShellCommand({ command: shellInput.at(0) ?? "", args: shellInput.slice(1), cwd })
                : await executeShellCommand({ ...shellInput, cwd });
            const scriptStdout = scriptOutput.stdout.trim();
            if (postProcess) {
                suggestions.push(...postProcess(scriptStdout, tokens));
            }
            else if (splitOn) {
                suggestions.push(...scriptStdout.split(splitOn).map((name) => ({ name })));
            }
        }
        if (custom) {
            suggestions.push(...(await custom(tokens, executeShellCommand, getGeneratorContext(cwd))));
        }
        if (template != null) {
            const templateSuggestions = await runTemplates(template, cwd, signal);
            suggestions.push(...(filterTemplateSuggestions ? filterTemplateSuggestions(templateSuggestions) : templateSuggestions));
        }
        signal?.throwIfAborted();
        return suggestions.filter((suggestion) => suggestion != null);
    }
    finally {
        endTiming("runtime.runGenerator", generatorTiming);
    }
};
export const getGeneratorQueryTerm = (generator, token) => {
    if (typeof generator.getQueryTerm === "function")
        return generator.getQueryTerm(token);
    if (generator.getQueryTerm == null)
        return token;
    const delimiterIndex = token.lastIndexOf(generator.getQueryTerm);
    return delimiterIndex === -1 ? token : token.slice(delimiterIndex + generator.getQueryTerm.length);
};
