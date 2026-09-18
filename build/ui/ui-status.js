// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import chalk from "chalk";
export const renderConfirmation = (live) => {
    const statusMessage = live ? chalk.green("live") : chalk.red("not found");
    return `inshellisense session [${statusMessage}]\n`;
};
export const renderMissingResources = () => {
    return chalk.red(`inshellisense resources out of date, run "is reinit" to refresh\n`);
};
