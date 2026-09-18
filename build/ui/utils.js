// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { resetColor } from "../utils/ansi.js";
import wrapAnsi from "wrap-ansi";
import chalk from "chalk";
import { wcswidth } from "../utils/unicode.js";
import { getConfig } from "../utils/config.js";
const borderCorners = {
    square: ["┌", "┐", "└", "┘"],
    rounded: ["╭", "╮", "╰", "╯"],
};
export const renderBox = (rows, width, borderColor) => {
    const result = [];
    const setColor = (text) => resetColor + (borderColor ? chalk.hex(borderColor).apply(text) : text);
    const [topLeft, topRight, bottomLeft, bottomRight] = borderCorners[getConfig().boxBorderStyle];
    result.push(setColor(topLeft + "─".repeat(width - 2) + topRight));
    rows.forEach((row) => {
        result.push(setColor("│") + row + setColor("│"));
    });
    result.push(setColor(bottomLeft + "─".repeat(width - 2) + bottomRight));
    return result;
};
export const truncateMultilineText = (description, width, maxHeight) => {
    const wrappedText = wrapAnsi(description, width, {
        trim: false,
        hard: true,
    });
    const lines = wrappedText.split("\n");
    const truncatedLines = lines.slice(0, maxHeight);
    if (lines.length > maxHeight) {
        truncatedLines[maxHeight - 1] = [...truncatedLines[maxHeight - 1]].slice(0, -1).join("") + "…";
    }
    return truncatedLines.map((line) => line.padEnd(width));
};
const wcPadEnd = (text, width, char = " ") => text + char.repeat(Math.max(width - wcswidth(text), 0));
const wcPoints = (text, length) => {
    const points = [...text];
    const accPoints = [];
    let accWidth = 0;
    for (const point of points) {
        const width = wcswidth(point);
        if (width + accWidth > length) {
            return wcswidth(accPoints.join("")) < length ? [accPoints.join(""), true] : [accPoints.slice(0, -1).join(""), true];
        }
        accPoints.push(point);
        accWidth += width;
    }
    return [accPoints.join(""), false];
};
/**
 * Truncates the text to the given width
 */
export const truncateText = (text, width) => {
    const [points, truncated] = wcPoints(text, width);
    return !truncated ? wcPadEnd(text, width) : wcPadEnd(points + "…", width);
};
