import * as vscode from "vscode";
import micromatch from "micromatch";
import path from "path";
import fs from "fs";
import { CompileMessage } from "./compile_process";
import { LanguageClient, ServerOptions, TransportKind } from "vscode-languageclient/node";

function findPackageJson(sourceDir: string, workspacePath: string): string {
    const root = path.parse(sourceDir).root;
    let step = sourceDir;
    while (!fs.existsSync(path.join(step, "package.json")) && step !== workspacePath && step !== root) {
        step = path.resolve(step, "../");
    }
    return step;
}

async function saveListener(
    e: vscode.TextDocument,
    output: vscode.OutputChannel,
    client: LanguageClient,
): Promise<void> {
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
    const includeGlobs: string[] = config.get("include", []).map((g) => `${workspacePath.replace(/\\/g, "/")}/${g}`);
    // micromatch supports glob array, bad typings
    if (!micromatch.isMatch(fileName.replace(/\\/g, "/"), includeGlobs)) {
        output.appendLine(`File name isn't matched. File:${fileName}, config of 'include':${includeGlobs.join(";")}`);
        return;
    }
    // always skip d.ts files
    if (fileName.endsWith(".d.ts")) {
        output.appendLine(`can't babel .d.ts file. File:${fileName}`);
        return;
    }
    const projectPath = findPackageJson(path.dirname(fileName), workspacePath);
    const outDir: string = config.get("outDir", "");
    const srcDir: string = config.get("srcDir", "");
    const outExt: string = config.get("outExt", ".js");
    const emitTSDeclaration = config.get("emitTSDeclaration", false);
    const emitTSDeclarationMap = config.get("emitTSDeclarationMap", true);
    // const outFilePath = path.resolve(workspacePath, outDir, vscode.workspace.asRelativePath(fileName, false));
    const outFilePath = path.resolve(projectPath, outDir, path.relative(path.join(projectPath, srcDir), fileName));
    const outFilePathJs = path.join(
        path.dirname(outFilePath),
        path.basename(outFilePath, path.extname(outFilePath)) + outExt,
    );
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
        ],
    });
    client.start();
    const disposable = vscode.workspace.onDidSaveTextDocument((e) => saveListener(e, channel, client));
    context.subscriptions.push(disposable, channel);
}

// this method is called when your extension is deactivated
export function deactivate() {
    if (client) {
        client.stop();
    }
}
