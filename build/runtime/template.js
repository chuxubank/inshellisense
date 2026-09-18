// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import log from "../utils/log.js";
import { readDirectory } from "./templateCache.js";
const filepathsTemplate = async (cwd, signal) => {
    const files = await readDirectory(cwd, signal);
    return files
        .filter((f) => f.isFile() || f.isDirectory())
        .map((f) => ({ name: f.name, priority: 55, context: { templateType: "filepaths" }, type: f.isDirectory() ? "folder" : "file" }));
};
const foldersTemplate = async (cwd, signal) => {
    const files = await readDirectory(cwd, signal);
    return files
        .filter((f) => f.isDirectory())
        .map((f) => ({
        name: f.name,
        priority: 55,
        context: { templateType: "folders" },
        type: "folder",
    }));
};
// TODO: implement history template
const historyTemplate = () => {
    return [];
};
// TODO: implement help template
const helpTemplate = () => {
    return [];
};
export const runTemplates = async (template, cwd, signal) => {
    const templates = template instanceof Array ? template : [template];
    return (await Promise.all(templates.map(async (t) => {
        try {
            switch (t) {
                case "filepaths":
                    return await filepathsTemplate(cwd, signal);
                case "folders":
                    return await foldersTemplate(cwd, signal);
                case "history":
                    return historyTemplate();
                case "help":
                    return helpTemplate();
            }
        }
        catch (e) {
            log.debug({ msg: "template failed", e, template: t, cwd });
            return [];
        }
    }))).flat();
};
