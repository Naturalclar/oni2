"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_1 = require("vscode-languageserver");
const vscode_uri_1 = require("vscode-uri");
const fs_1 = require("fs");
const vscode_css_languageservice_1 = require("vscode-css-languageservice");
const languageModelCache_1 = require("./languageModelCache");
const pathCompletion_1 = require("./pathCompletion");
const runner_1 = require("./utils/runner");
const documentContext_1 = require("./utils/documentContext");
const customData_1 = require("./customData");
// Create a connection for the server.
const connection = vscode_languageserver_1.createConnection();
console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);
process.on('unhandledRejection', (e) => {
    connection.console.error(runner_1.formatError(`Unhandled exception`, e));
});
// Create a text document manager.
const documents = new vscode_languageserver_1.TextDocuments(vscode_css_languageservice_1.TextDocument);
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);
const stylesheets = languageModelCache_1.getLanguageModelCache(10, 60, document => getLanguageService(document).parseStylesheet(document));
documents.onDidClose(e => {
    stylesheets.onDocumentRemoved(e.document);
});
connection.onShutdown(() => {
    stylesheets.dispose();
});
let scopedSettingsSupport = false;
let foldingRangeLimit = Number.MAX_VALUE;
let workspaceFolders;
const languageServices = {};
const fileSystemProvider = {
    stat(documentUri) {
        const filePath = vscode_uri_1.URI.parse(documentUri).fsPath;
        return new Promise((c, e) => {
            fs_1.stat(filePath, (err, stats) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        return c({
                            type: vscode_css_languageservice_1.FileType.Unknown,
                            ctime: -1,
                            mtime: -1,
                            size: -1
                        });
                    }
                    else {
                        return e(err);
                    }
                }
                let type = vscode_css_languageservice_1.FileType.Unknown;
                if (stats.isFile()) {
                    type = vscode_css_languageservice_1.FileType.File;
                }
                else if (stats.isDirectory()) {
                    type = vscode_css_languageservice_1.FileType.Directory;
                }
                else if (stats.isSymbolicLink()) {
                    type = vscode_css_languageservice_1.FileType.SymbolicLink;
                }
                c({
                    type,
                    ctime: stats.ctime.getTime(),
                    mtime: stats.mtime.getTime(),
                    size: stats.size
                });
            });
        });
    }
};
// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
connection.onInitialize((params) => {
    workspaceFolders = params.workspaceFolders;
    if (!Array.isArray(workspaceFolders)) {
        workspaceFolders = [];
        if (params.rootPath) {
            workspaceFolders.push({ name: '', uri: vscode_uri_1.URI.file(params.rootPath).toString() });
        }
    }
    const dataPaths = params.initializationOptions.dataPaths || [];
    const customDataProviders = customData_1.getDataProviders(dataPaths);
    function getClientCapability(name, def) {
        const keys = name.split('.');
        let c = params.capabilities;
        for (let i = 0; c && i < keys.length; i++) {
            if (!c.hasOwnProperty(keys[i])) {
                return def;
            }
            c = c[keys[i]];
        }
        return c;
    }
    const snippetSupport = !!getClientCapability('textDocument.completion.completionItem.snippetSupport', false);
    scopedSettingsSupport = !!getClientCapability('workspace.configuration', false);
    foldingRangeLimit = getClientCapability('textDocument.foldingRange.rangeLimit', Number.MAX_VALUE);
    languageServices.css = vscode_css_languageservice_1.getCSSLanguageService({ customDataProviders, fileSystemProvider, clientCapabilities: params.capabilities });
    languageServices.scss = vscode_css_languageservice_1.getSCSSLanguageService({ customDataProviders, fileSystemProvider, clientCapabilities: params.capabilities });
    languageServices.less = vscode_css_languageservice_1.getLESSLanguageService({ customDataProviders, fileSystemProvider, clientCapabilities: params.capabilities });
    const capabilities = {
        textDocumentSync: vscode_languageserver_1.TextDocumentSyncKind.Incremental,
        completionProvider: snippetSupport ? { resolveProvider: false, triggerCharacters: ['/', '-'] } : undefined,
        hoverProvider: true,
        documentSymbolProvider: true,
        referencesProvider: true,
        definitionProvider: true,
        documentHighlightProvider: true,
        documentLinkProvider: {
            resolveProvider: false
        },
        codeActionProvider: true,
        renameProvider: true,
        colorProvider: {},
        foldingRangeProvider: true,
        selectionRangeProvider: true
    };
    return { capabilities };
});
function getLanguageService(document) {
    let service = languageServices[document.languageId];
    if (!service) {
        connection.console.log('Document type is ' + document.languageId + ', using css instead.');
        service = languageServices['css'];
    }
    return service;
}
let documentSettings = {};
// remove document settings on close
documents.onDidClose(e => {
    delete documentSettings[e.document.uri];
});
function getDocumentSettings(textDocument) {
    if (scopedSettingsSupport) {
        let promise = documentSettings[textDocument.uri];
        if (!promise) {
            const configRequestParam = { items: [{ scopeUri: textDocument.uri, section: textDocument.languageId }] };
            promise = connection.sendRequest(vscode_languageserver_1.ConfigurationRequest.type, configRequestParam).then(s => s[0]);
            documentSettings[textDocument.uri] = promise;
        }
        return promise;
    }
    return Promise.resolve(undefined);
}
// The settings have changed. Is send on server activation as well.
connection.onDidChangeConfiguration(change => {
    updateConfiguration(change.settings);
});
function updateConfiguration(settings) {
    for (const languageId in languageServices) {
        languageServices[languageId].configure(settings[languageId]);
    }
    // reset all document settings
    documentSettings = {};
    // Revalidate any open text documents
    documents.all().forEach(triggerValidation);
}
const pendingValidationRequests = {};
const validationDelayMs = 500;
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    triggerValidation(change.document);
});
// a document has closed: clear all diagnostics
documents.onDidClose(event => {
    cleanPendingValidation(event.document);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
function cleanPendingValidation(textDocument) {
    const request = pendingValidationRequests[textDocument.uri];
    if (request) {
        clearTimeout(request);
        delete pendingValidationRequests[textDocument.uri];
    }
}
function triggerValidation(textDocument) {
    cleanPendingValidation(textDocument);
    pendingValidationRequests[textDocument.uri] = setTimeout(() => {
        delete pendingValidationRequests[textDocument.uri];
        validateTextDocument(textDocument);
    }, validationDelayMs);
}
function validateTextDocument(textDocument) {
    const settingsPromise = getDocumentSettings(textDocument);
    settingsPromise.then(settings => {
        const stylesheet = stylesheets.get(textDocument);
        const diagnostics = getLanguageService(textDocument).doValidation(textDocument, stylesheet, settings);
        // Send the computed diagnostics to VSCode.
        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
    }, e => {
        connection.console.error(runner_1.formatError(`Error while validating ${textDocument.uri}`, e));
    });
}
connection.onCompletion((textDocumentPosition, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(textDocumentPosition.textDocument.uri);
        if (!document) {
            return null;
        }
        const cssLS = getLanguageService(document);
        const pathCompletionList = {
            isIncomplete: false,
            items: []
        };
        cssLS.setCompletionParticipants([pathCompletion_1.getPathCompletionParticipant(document, workspaceFolders, pathCompletionList)]);
        const result = cssLS.doComplete(document, textDocumentPosition.position, stylesheets.get(document));
        return {
            isIncomplete: pathCompletionList.isIncomplete,
            items: [...pathCompletionList.items, ...result.items]
        };
    }, null, `Error while computing completions for ${textDocumentPosition.textDocument.uri}`, token);
});
connection.onHover((textDocumentPosition, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(textDocumentPosition.textDocument.uri);
        if (document) {
            const styleSheet = stylesheets.get(document);
            return getLanguageService(document).doHover(document, textDocumentPosition.position, styleSheet);
        }
        return null;
    }, null, `Error while computing hover for ${textDocumentPosition.textDocument.uri}`, token);
});
connection.onDocumentSymbol((documentSymbolParams, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(documentSymbolParams.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).findDocumentSymbols(document, stylesheet);
        }
        return [];
    }, [], `Error while computing document symbols for ${documentSymbolParams.textDocument.uri}`, token);
});
connection.onDefinition((documentDefinitionParams, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(documentDefinitionParams.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).findDefinition(document, documentDefinitionParams.position, stylesheet);
        }
        return null;
    }, null, `Error while computing definitions for ${documentDefinitionParams.textDocument.uri}`, token);
});
connection.onDocumentHighlight((documentHighlightParams, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(documentHighlightParams.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).findDocumentHighlights(document, documentHighlightParams.position, stylesheet);
        }
        return [];
    }, [], `Error while computing document highlights for ${documentHighlightParams.textDocument.uri}`, token);
});
connection.onDocumentLinks(async (documentLinkParams, token) => {
    return runner_1.runSafeAsync(async () => {
        const document = documents.get(documentLinkParams.textDocument.uri);
        if (document) {
            const documentContext = documentContext_1.getDocumentContext(document.uri, workspaceFolders);
            const stylesheet = stylesheets.get(document);
            return await getLanguageService(document).findDocumentLinks2(document, stylesheet, documentContext);
        }
        return [];
    }, [], `Error while computing document links for ${documentLinkParams.textDocument.uri}`, token);
});
connection.onReferences((referenceParams, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(referenceParams.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).findReferences(document, referenceParams.position, stylesheet);
        }
        return [];
    }, [], `Error while computing references for ${referenceParams.textDocument.uri}`, token);
});
connection.onCodeAction((codeActionParams, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(codeActionParams.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).doCodeActions(document, codeActionParams.range, codeActionParams.context, stylesheet);
        }
        return [];
    }, [], `Error while computing code actions for ${codeActionParams.textDocument.uri}`, token);
});
connection.onDocumentColor((params, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(params.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).findDocumentColors(document, stylesheet);
        }
        return [];
    }, [], `Error while computing document colors for ${params.textDocument.uri}`, token);
});
connection.onColorPresentation((params, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(params.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).getColorPresentations(document, stylesheet, params.color, params.range);
        }
        return [];
    }, [], `Error while computing color presentations for ${params.textDocument.uri}`, token);
});
connection.onRenameRequest((renameParameters, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(renameParameters.textDocument.uri);
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).doRename(document, renameParameters.position, renameParameters.newName, stylesheet);
        }
        return null;
    }, null, `Error while computing renames for ${renameParameters.textDocument.uri}`, token);
});
connection.onFoldingRanges((params, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(params.textDocument.uri);
        if (document) {
            return getLanguageService(document).getFoldingRanges(document, { rangeLimit: foldingRangeLimit });
        }
        return null;
    }, null, `Error while computing folding ranges for ${params.textDocument.uri}`, token);
});
connection.onSelectionRanges((params, token) => {
    return runner_1.runSafe(() => {
        const document = documents.get(params.textDocument.uri);
        const positions = params.positions;
        if (document) {
            const stylesheet = stylesheets.get(document);
            return getLanguageService(document).getSelectionRanges(document, positions, stylesheet);
        }
        return [];
    }, [], `Error while computing selection ranges for ${params.textDocument.uri}`, token);
});
// Listen on the connection
connection.listen();
//# sourceMappingURL=cssServerMain.js.map