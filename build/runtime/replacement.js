// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
const commonPrefixLength = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i])
        i++;
    return i;
};
export const calculateReplacement = (token, suggestion) => {
    const suggestionText = suggestion.insertValue ?? suggestion.name + " ";
    if (token == null || token.complete) {
        if (!suggestionText.trim())
            return undefined;
        return { backspaceCount: 0, insertText: suggestionText };
    }
    const typedText = token.token;
    const tokenDisplayWidth = token.tokenLength;
    if (suggestion.insertValue != null && suggestion.insertValue !== suggestion.name) {
        return { backspaceCount: tokenDisplayWidth, insertText: suggestionText };
    }
    const target = suggestion.name + " ";
    const prefixLen = commonPrefixLength(typedText, target);
    if (prefixLen === typedText.length) {
        const remaining = target.substring(prefixLen);
        if (!remaining.trim())
            return undefined;
        return { backspaceCount: 0, insertText: remaining };
    }
    return { backspaceCount: tokenDisplayWidth, insertText: target };
};
export const applyReplacement = (action) => {
    return "\u007F".repeat(action.backspaceCount) + action.insertText;
};
