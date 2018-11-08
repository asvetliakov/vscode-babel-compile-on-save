import * as vscode from 'vscode';
import micromatch from "micromatch";
import path from "path";
import makeDir from "make-dir";
import fs from "fs";
import { promisify } from "util";

const promisedWriteFile = promisify(fs.writeFile);

const parseConfigHost: import("typescript").ParseConfigFileHost = {
    fileExists: fs.existsSync,
    getCurrentDirectory: () => __dirname,
    readFile: path => fs.readFileSync(path, { encoding: "utf8" }),
    onUnRecoverableConfigFileDiagnostic: diag => {
        throw new Error("Error when parsing TS config file: " + diag.messageText.toString());
    },
    // we don't need any directory reading
    readDirectory: () => [],
    useCaseSensitiveFileNames: true,
};


/**
 * Compile TS declaration. Creates program only with single sourcefile and tries to get the declaration for it
 * @param filePath File path
 */
async function compileTypescript(filePath: string, emitMap = true): Promise<void> {
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
        return;
    }
    let tsPath: string;
    try {
        tsPath = require.resolve("typescript", {
            paths: [
                path.dirname(filePath),
                __dirname,
            ],
        });
    } catch {
        throw new Error("Unable to instantiate typescript");
    }
    const ts: typeof import("typescript") = require(tsPath);
    const configPath = ts.findConfigFile(filePath, parseConfigHost.fileExists);
    if (!configPath) {
        return;
    }
    const parsedConfig = ts.getParsedCommandLineOfConfigFile(
        configPath,
        {
            declaration: true,
            declarationMap: emitMap,
            emitDeclarationOnly: true,
            isolatedModules: false,
            composite: false,
            skipLibCheck: true,
            noEmitHelpers: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            noEmit: false,
            // 2-2.5x emitting faster 250-300ms vs 600-700ms
            // unfortunately declaration could be wrong without it
            // noResolve: true,
            // skip any errors since with noResolve it will be a bunch of them
            noEmitOnError: false,
        },
        parseConfigHost,
    );
    if (!parsedConfig) {
        throw new Error(`Unable to parse TS config ${configPath}`);
    }
    const program = ts.createProgram({
        options: parsedConfig.options,
        rootNames: [filePath],
    });
    program.emit();
}

const SOURCEMAP_REGEX = /^\s*\/\/#\s*sourceMappingURL/m;

/**
 * Compiles file through babel
 * @param filePath Input file path
 * @param outputPath Output file path
 */
async function compileBabel(filePath: string, outputPath: string): Promise<void> {
    const sourceFileName = path.relative(path.dirname(outputPath), filePath);
    // require @babel/core
    let babelPath: string;
    try {
        babelPath = require.resolve("@babel/core", {
            paths: [
                path.dirname(filePath),
                __dirname,
            ]
        });
    } catch {
        throw new Error("Unable to instantiate @babel/core");
    }
    const babel: typeof import("@babel/core") = require(babelPath);
    const res = await babel.transformFileAsync(filePath, {
        root: filePath,
        rootMode: "upward",
        sourceFileName,
    } as any);
    // babel may return empty file and it's valid case, for example TS file with only declared types
    if (!res) {
        throw new Error(`Got empty result when transipling the file: ${filePath}`);
    }
    const outputMapPath = outputPath + ".map";
    let code = res.code || "";
    const map = res.map;
    // make sure that output directory exists
    await makeDir(path.dirname(outputPath));
    // add sourcemapping url if there is no sourcemap in the code
    const hasSourceMapping = SOURCEMAP_REGEX.test(code || "");
    if (!hasSourceMapping && map) {
        code += `\n//# sourceMappingURL=${path.basename(outputMapPath)}`;
    }
    await Promise.all([
        promisedWriteFile(outputPath, code, { encoding: "utf8" }),
        map ? promisedWriteFile(outputMapPath, JSON.stringify(map), { encoding: "utf8" }) : Promise.resolve(),
    ]);
}

async function saveListener(e: vscode.TextDocument, output: vscode.OutputChannel): Promise<void> {
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
    output.appendLine(`Compiling file: ${fileName} for workspace: ${workspacePath}, output file: ${outFilePathJs}`);

    try {
        const babelTime = new Date().getTime();
        await compileBabel(fileName, outFilePathJs);
        output.appendLine(`Babel compilation took: ${new Date().getTime() - babelTime}ms`);
    } catch (e) {
        output.appendLine(`Unable to transpile file: ${e.message}`);
        return;
    }
    if (emitTSDeclaration) {
        try {
            const tsTime = new Date().getTime();
            await compileTypescript(fileName, emitTSDeclarationMap);
            output.appendLine(`TS compilation took: ${new Date().getTime() - tsTime}ms`);
        } catch (e) {
            output.appendLine(`Unable to produce TS declaration: ${e.message}`);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const channel = vscode.window.createOutputChannel("Babel Compile On Save");
    const disposable = vscode.workspace.onDidSaveTextDocument(e => saveListener(e, channel));
    context.subscriptions.push(disposable, channel);
}

// this method is called when your extension is deactivated
export function deactivate() {
}