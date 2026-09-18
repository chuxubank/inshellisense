// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
const inshellisenseFolderName = "inshellisense";
export const resolveXdgConfigHome = (value, platform) => {
    return platform !== "win32" && value != null && path.isAbsolute(value) ? value : undefined;
};
export const resolveXdgDataHome = (value, homeDirectory, platform) => {
    if (platform === "win32")
        return;
    return value != null && path.isAbsolute(value) ? value : path.join(homeDirectory, ".local", "share");
};
export const resolveResourcesPath = (homeDirectory, xdgDataDirectory, hasLegacyResources) => {
    return xdgDataDirectory == null || hasLegacyResources
        ? path.join(homeDirectory, `.${inshellisenseFolderName}`)
        : path.join(xdgDataDirectory, inshellisenseFolderName);
};
export const resolveConfigFilePath = (homeDirectory, xdgConfigDirectory) => {
    const configDirectory = xdgConfigDirectory ?? path.join(homeDirectory, ".config");
    return path.join(configDirectory, inshellisenseFolderName, "rc.toml");
};
export const getResourcePaths = (resourcesPath) => ({
    logging: path.join(resourcesPath, "log"),
    native: path.join(resourcesPath, "native"),
    shell: path.join(resourcesPath, "shell"),
    spec: path.join(resourcesPath, "spec"),
    init: path.join(resourcesPath, "init"),
    version: path.join(resourcesPath, "version.txt"),
});
const homeDirectory = os.homedir();
const legacyResourcesPath = path.join(homeDirectory, `.${inshellisenseFolderName}`);
export const xdgConfigHome = resolveXdgConfigHome(process.env.XDG_CONFIG_HOME, process.platform);
export const xdgDataHome = resolveXdgDataHome(process.env.XDG_DATA_HOME, homeDirectory, process.platform);
export const preferredResourcesPath = resolveResourcesPath(homeDirectory, xdgDataHome, false);
export const allResourcesPath = resolveResourcesPath(homeDirectory, xdgDataHome, fs.existsSync(legacyResourcesPath));
export const usesLegacyResources = allResourcesPath === legacyResourcesPath;
export const xdgConfigPath = resolveConfigFilePath(homeDirectory, xdgConfigHome);
const resourcePaths = getResourcePaths(allResourcesPath);
export const loggingResourcesPath = resourcePaths.logging;
export const nativeResourcesPath = resourcePaths.native;
export const shellResourcesPath = resourcePaths.shell;
export const specResourcesPath = resourcePaths.spec;
export const initResourcesPath = resourcePaths.init;
export const versionResourcePath = resourcePaths.version;
