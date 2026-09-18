// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { createRequire } from "node:module";
const version = "__VERSION__";
export const getVersion = () => version === "__VERSION__" ? createRequire(import.meta.url)("../../package.json").version : version;
