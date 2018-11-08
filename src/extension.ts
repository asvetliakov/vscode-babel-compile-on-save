import * as vscode from 'vscode';
import micromatch from "micromatch";
import path from "path";
import { CompileMessage } from './compile_process';
import { LanguageClient, ServerOptions, TransportKind } from "vscode-languageclient";

async function saveListener(e: vscode.TextDocument, output: vscode.OutputChannel, client: LanguageClient): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(e.uri);
    if (!workspaceFolder || workspaceFolder.uri.scheme !== "file") {
        return;
    }
    const workspacePath = workspaceFolder.uri.fsPath;
    const config = vscode.workspace.getConfiguration("babel-compile-on-save", e.uri);
    const fileName = e.fileName;
    if (!config || !fileName) {
        return;
    }
    const includeGlobs: string[] = config.get("include", []).map(g => `${workspacePath}/${g}`);
    // micromatch supports glob array, bad typings
    if (!micromatch.isMatch(fileName, includeGlobs as any)) {
        return;
    }
    // always skip d.ts files
    if (fileName.endsWith(".d.ts")) {
        return;
    }
    const outDir: string = config.get("outDir", "");
    const srcDir: string = config.get("srcDir", "");
    const outExt: string = config.get("outExt", ".js");
    const emitTSDeclaration = config.get("emitTSDeclaration", false);
    const emitTSDeclarationMap = config.get("emitTSDeclarationMap", true);
    // const outFilePath = path.resolve(workspacePath, outDir, vscode.workspace.asRelativePath(fileName, false));
    const outFilePath = path.resolve(workspacePath, outDir, path.relative(path.join(workspacePath, srcDir), fileName));
    const outFilePathJs = path.join(path.dirname(outFilePath), path.basename(outFilePath, path.extname(outFilePath)) + outExt);
    output.appendLine(`Compiling file: ${fileName}, output file: ${outFilePathJs}`);

    const message: CompileMessage = {
        compileTS: emitTSDeclaration,
        emitTSDeclarationMap,
        fileName: fileName,
        outFileName: outFilePathJs,
    };
    client.sendRequest("babelCompileOnSave", message);
}

let client: LanguageClient;
export function activate(context: vscode.ExtensionContext) {
    const channel = vscode.window.createOutputChannel("Babel Compile On Save");
    const serverModule = context.asAbsolutePath(path.join("out", "compile_process.js"));
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc },
    };
    client = new LanguageClient("BabelCompileOnSaveProcess", serverOptions, {
        outputChannel: channel,
        documentSelector: [
            { scheme: "file", language: "javascript" },
            { scheme: "file", language: "typescript" },
            { scheme: "file", language: "javascriptreact" },
            { scheme: "file", language: "typescriptreact" },
        ]
    });
    const clientDisp = client.start();
    const disposable = vscode.workspace.onDidSaveTextDocument(e => saveListener(e, channel, client));
    context.subscriptions.push(disposable, channel, clientDisp);
}

// this method is called when your extension is deactivated
export function deactivate() {
    if (client) {
        client.stop();
    }
}