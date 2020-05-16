"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const parser = require("web-tree-sitter");
const jsonc = require("jsonc-parser");
const fs = require("fs");
const path = require("path");
const timers_1 = require("timers");
// Grammar class
const parserPromise = parser.init();
class Grammar {
    constructor(lang) {
        // Grammar
        this.simpleTerms = {};
        this.complexTerms = [];
        this.complexScopes = {};
        // Grammar
        this.lang = lang;
        const grammarFile = __dirname + "/../grammars/" + lang + ".json";
        const grammarJson = jsonc.parse(fs.readFileSync(grammarFile).toString());
        for (const t in grammarJson.simpleTerms)
            this.simpleTerms[t] = grammarJson.simpleTerms[t];
        for (const t in grammarJson.complexTerms)
            this.complexTerms[t] = grammarJson.complexTerms[t];
        for (const t in grammarJson.complexScopes)
            this.complexScopes[t] = grammarJson.complexScopes[t];
        this.complexDepth = 0;
        this.complexOrder = false;
        for (const s in this.complexScopes) {
            const depth = s.split(">").length;
            if (depth > this.complexDepth)
                this.complexDepth = depth;
            if (s.indexOf("[") >= 0)
                this.complexOrder = true;
        }
        this.complexDepth--;
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            // Parser
            yield parserPromise;
            this.parser = new parser();
            let langFile = path.join(__dirname, "../parsers", this.lang + ".wasm");
            const langObj = yield parser.Language.load(langFile);
            this.parser.setLanguage(langObj);
        });
    }
}
// Language grammars
const grammars = {};
// Syntax trees
let trees = {};
// Syntax scope for node in position
let debugDepth = -1;
function scopeInfo(doc, pos) {
    const uri = doc.uri.toString();
    if (!(uri in trees))
        return null;
    const grammar = grammars[doc.languageId];
    const xy = { row: pos.line, column: pos.character };
    let node = trees[uri].rootNode.descendantForPosition(xy);
    if (!node)
        return null;
    let type = node.type;
    if (!node.isNamed())
        type = '"' + type + '"';
    let parent = node.parent;
    const depth = Math.max(grammar.complexDepth, debugDepth);
    for (let i = 0; i < depth && parent; i++) {
        let parentType = parent.type;
        if (!parent.isNamed())
            parentType = '"' + parentType + '"';
        type = parentType + " > " + type;
        parent = parent.parent;
    }
    // If there is also order complexity
    if (grammar.complexOrder) {
        let index = 0;
        let sibling = node.previousSibling;
        while (sibling) {
            if (sibling.type === node.type)
                index++;
            sibling = sibling.previousSibling;
        }
        let rindex = -1;
        sibling = node.nextSibling;
        while (sibling) {
            if (sibling.type === node.type)
                rindex--;
            sibling = sibling.nextSibling;
        }
        type = type + "[" + index + "]" + "[" + rindex + "]";
    }
    return {
        contents: [type],
        range: new vscode.Range(node.startPosition.row, node.startPosition.column, node.endPosition.row, node.endPosition.column)
    };
}
// Extension activation
function activate(context) {
    return __awaiter(this, void 0, void 0, function* () {
        // Languages
        let availableGrammars = [];
        fs.readdirSync(__dirname + "/../grammars/").forEach(name => {
            availableGrammars.push(path.basename(name, ".json"));
        });
        let availableParsers = [];
        fs.readdirSync(__dirname + "/../parsers/").forEach(name => {
            availableParsers.push(path.basename(name, ".wasm"));
        });
        const enabledLangs = vscode.workspace.getConfiguration("syntax").get("highlightLanguages");
        let supportedLangs = [];
        availableGrammars.forEach(lang => {
            if (availableParsers.includes(lang) && enabledLangs.includes(lang))
                supportedLangs.push(lang);
        });
        // Term colors
        const availableTerms = [
            "type", "scope", "function", "variable", "number", "string", "comment",
            "constant", "directive", "control", "operator", "modifier", 'macro', "punctuation",
        ];
        const enabledTerms = vscode.workspace.getConfiguration("syntax").get("highlightTerms");
        let supportedTerms = [];
        availableTerms.forEach(term => {
            // if (enabledTerms.includes(term))
                supportedTerms.push(term);
        });
        if (!vscode.workspace.getConfiguration("syntax").get("highlightComment"))
            if (supportedTerms.includes("comment"))
                supportedTerms.splice(supportedTerms.indexOf("comment"), 1);
        // Debug depth
        debugDepth = vscode.workspace.getConfiguration("syntax").get("debugDepth");
        // Decoration definitions
        const highlightDecors = {};
        for (const c of supportedTerms)
            highlightDecors[c] = vscode.window.
                createTextEditorDecorationType({
                color: new vscode.ThemeColor("syntax." + c)
            });
        // Decoration cache
        const decorCache = {};
        // Timer to schedule decoration update and refresh
        let updateTimer = undefined;
        let refreshTimer = undefined;
        console.log('{Syntax Highlighter} has been activated');
        let visibleEditors = vscode.window.visibleTextEditors;
        let visibleUris = [];
        let refreshUris = [];
        function refreshDecor() {
            for (const e of visibleEditors) {
                const uri = e.document.uri.toString();
                if (!refreshUris.includes(uri))
                    continue;
                if (!(uri in decorCache))
                    continue;
                const decorations = decorCache[uri];
                for (const c in decorations)
                    e.setDecorations(highlightDecors[c], decorations[c]);
            }
            refreshUris = [];
        }
        function enqueueDecorRefresh() {
            if (refreshTimer) {
                timers_1.clearTimeout(refreshTimer);
                refreshTimer = undefined;
            }
            refreshTimer = setTimeout(refreshDecor, 20);
        }
        function isMacro(text){
            for(var i=0;i<text.length;i++){
                var c=text.charAt(i);
                if(c != '_' && (c<'A' || c>'Z'))
                    return false;
                }
            return true;
        }
        function buildDecor(doc) {
            const uri = doc.uri.toString();
            if (!(uri in trees))
                return;
            const grammar = grammars[doc.languageId];
            // Decorations
            let decorations = {};
            for (const c in highlightDecors)
                decorations[c] = [];
            // Travel tree and make decorations
            let stack = [];
            let node = trees[uri].rootNode.firstChild;
            while (stack.length > 0 || node) {
                // Go deeper
                if (node) {
                    stack.push(node);
                    node = node.firstChild;
                }
                // Go back
                else {
                    node = stack.pop();
                    let type = node.type;
                    if (!node.isNamed())
                        type = '"' + type + '"';
                    // Simple one-level terms
                    let color = undefined;
                    if (!grammar.complexTerms.includes(type)) {
                        color = grammar.simpleTerms[type];
                    }
                    // Complex terms require multi-level analyzes
                    else {
                        // Build complex scopes
                        let desc = type;
                        let scopes = [desc];
                        let parent = node.parent;
                        for (let i = 0; i < grammar.complexDepth && parent; i++) {
                            let parentType = parent.type;
                            if (!parent.isNamed())
                                parentType = '"' + parentType + '"';
                            desc = parentType + " > " + desc;
                            scopes.push(desc);
                            parent = parent.parent;
                        }
                        // If there is also order complexity
                        if (grammar.complexOrder) {
                            let index = 0;
                            let sibling = node.previousSibling;
                            while (sibling) {
                                if (sibling.type === node.type)
                                    index++;
                                sibling = sibling.previousSibling;
                            }
                            let rindex = -1;
                            sibling = node.nextSibling;
                            while (sibling) {
                                if (sibling.type === node.type)
                                    rindex--;
                                sibling = sibling.nextSibling;
                            }
                            let orderScopes = [];
                            for (let i = 0; i < scopes.length; i++)
                                orderScopes.push(scopes[i], scopes[i] + "[" + index + "]", scopes[i] + "[" + rindex + "]");
                            scopes = orderScopes;
                        }
                        // Use most complex scope
                        for (const d of scopes)
                            if (d in grammar.complexScopes)
                                color = grammar.complexScopes[d];
                    }
                    let text = node.text;
                    if (isMacro(text) == true)
                        color = "macro";
                    // If term is found add decoration
                    if (color in highlightDecors) {
                        decorations[color].push(new vscode.Range(new vscode.Position(node.startPosition.row, node.startPosition.column), new vscode.Position(node.endPosition.row, node.endPosition.column)));
                    }
                    // Go right
                    node = node.nextSibling;
                }
            }
            // Cache and refresh decorations
            decorCache[uri] = decorations;
            if (!refreshUris.includes(uri))
                refreshUris.push(uri);
        }
        function updateDecor() {
            for (const e of visibleEditors) {
                const uri = e.document.uri.toString();
                if (!(uri in trees))
                    continue;
                if (uri in decorCache)
                    continue;
                buildDecor(e.document);
            }
            if (refreshUris.length > 0)
                enqueueDecorRefresh();
        }
        function enqueueDecorUpdate() {
            if (updateTimer) {
                timers_1.clearTimeout(updateTimer);
                updateTimer = undefined;
            }
            updateTimer = setTimeout(updateDecor, 20);
        }
        function initTree(doc) {
            return __awaiter(this, void 0, void 0, function* () {
                const lang = doc.languageId;
                if (!supportedLangs.includes(lang))
                    return;
                if (!(lang in grammars)) {
                    grammars[lang] = new Grammar(lang);
                    yield grammars[lang].init();
                }
                const uri = doc.uri.toString();
                trees[uri] = grammars[lang].parser.parse(doc.getText());
                enqueueDecorUpdate();
            });
        }
        function updateTree(doc) {
            const uri = doc.uri.toString();
            const lang = doc.languageId;
            if (!(uri in trees))
                return;
            // Update tree
            trees[uri] = grammars[lang].parser.parse(doc.getText());
            // Invalidate decoration cache and enqueue update
            delete decorCache[uri];
            if (visibleUris.includes(uri))
                enqueueDecorUpdate();
        }
        // Create trees for already opened documents
        for (const doc of vscode.workspace.textDocuments)
            yield initTree(doc);
        enqueueDecorUpdate();
        vscode.workspace.onDidOpenTextDocument((doc) => __awaiter(this, void 0, void 0, function* () {
            yield initTree(doc);
        }), null, context.subscriptions);
        vscode.workspace.onDidCloseTextDocument(doc => {
            const uri = doc.uri.toString();
            delete trees[uri];
            delete decorCache[uri];
            if (refreshUris.includes(uri))
                refreshUris.splice(refreshUris.indexOf(uri), 1);
        }, null, context.subscriptions);
        vscode.workspace.onDidChangeTextDocument(event => {
            const uri = event.document.uri.toString();
            if (!(uri in trees))
                return;
            if (event.contentChanges.length < 1)
                return;
            updateTree(event.document);
        }, null, context.subscriptions);
        // Enumerate already visible editors
        visibleEditors = vscode.window.visibleTextEditors;
        visibleUris = [];
        for (const e of visibleEditors) {
            const uri = e.document.uri.toString();
            if (!visibleUris.includes(uri))
                visibleUris.push(uri);
        }
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            // Flag refresh for new editors
            let needUpdate = false;
            for (const e of editors) {
                const uri = e.document.uri.toString();
                if (visibleEditors.includes(e))
                    continue;
                if (!refreshUris.includes(uri))
                    refreshUris.push(uri);
                if (uri in trees)
                    needUpdate = true;
            }
            // Set visible editors
            visibleEditors = editors;
            visibleUris = [];
            for (const e of visibleEditors) {
                const uri = e.document.uri.toString();
                if (!visibleUris.includes(uri))
                    visibleUris.push(uri);
            }
            // Enqueue refresh if required
            if (needUpdate)
                enqueueDecorUpdate();
        }, null, context.subscriptions);
        // Register debug hover providers
        // Very useful tool for implementation and fixing of grammars
        if (vscode.workspace.getConfiguration("syntax").get("debugHover"))
            for (const lang of supportedLangs)
                vscode.languages.registerHoverProvider(lang, { provideHover: scopeInfo });
    });
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map