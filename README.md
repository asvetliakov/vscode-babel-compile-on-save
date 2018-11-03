# babel-compile-on-save

## Features

* Automatically transpile file by babel on save
* Experimental: Fast-emitting TS declaration for saved file (250-400ms to produce declaration)
* Use either project's @babel/core / typescript (for declaration emit) or bundled ones (if not found)

## Requirements

* Babel 7.1+ (for ```upward``` rootMode)

## Extension Settings

This extension contributes the following settings:

* `babel-compile-on-save.include`: List of source file globs to transpile through babel. Something like ```[ "src/**/*.ts", "src/**/*.js" ]```. Default [].
* `babel-compile-on-save.outDir`: Output directory for transpiled files. E.g. ```build``` or similar. Setting to ```""``` will place transpiled files next to the source file (Beware: may overwrite sourcefile if they have same extension, i.e. ```file.js -> file.js```). Default ```build```.
* `babel-compile-on-save.srcDir`: Your src root directory. Used to calculate correct sourceFileName mapping from result sourcemap. Default ```src```.
* `babel-compile-on-save.outExt`: Output filename extension. Default ```.js```. Possible choices: ```.mjs``` or ```.jsx``` (for react-native)
* `babel-compile-on-save.emitTSDeclaration`: Emit TS declaration for transpiled file. Uses project's tsconfig.json for output paths. Ignores any errors. Suggested use is with project-wide ```tsc -w --noEmit``` background task which will produce errors.  Default ```false```.
* `babel-compile-on-save.emitTSDeclarationMap`: Also emit declaration map. May be handy if use want to put ```isolatedModules: true``` into your main tsconfig.json (VSCode loads only this config), since you can't use both declaration (and declarationMap) and isolatedModules at same time. The extension will set internally isolatedModules to false when emitting declaration file on save. You can also have separate tsconfig.check.json (or whatever name) with isolatedModules: true and run background task with error reporting, but the problem here that vscode will hide errors related to isolatedModules setting when opening the file. For initial declaration generation for project i recommend to use separate tsconfig.build.json with isolatedModules turned off.

## Sourcemaps
Sourcemap will be written when detected. Set ```sourceMap: true``` (or ```"inline"```) in ```babel.config.js``` or whatever you use for babel config file.

## emitTSDeclaration
This feature mainly is to support TS monorepo scenarios compiled through babel and @babel/preset-typescript. With ```--emitDeclarationOnly``` the incremental compilation of typescript takes around ~6-10 seconds to finish on medium (or greater) sized projects. This is trying to workaround it by creating TS program with only one file and producing declaration for it only. The result is 250-400ms vs 6-10 seconds. Any errors will be ignored, so you need to have separate reporting channel: ```tsc -w --noEmit``` is pretty good example and fast.