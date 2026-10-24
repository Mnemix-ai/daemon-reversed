# Electron API Demos

## Target and question

- Target: Electron API Demos 2.0.2, commit `26b3d1d57adc0cc1ef505cc84bceadcb51a4987c` (2022-10-17, "chore: bump json-schema and jsprim (#518)").
- Licence: MIT. `license.md` in that commit is the MIT licence, copyright 2016-2018 GitHub Inc. The REA workflow does not emit a licence field; the licence was read from that file in the pinned source archive.
- Source or artifact: directory extracted from `https://github.com/electron/electron-api-demos/archive/26b3d1d57adc0cc1ef505cc84bceadcb51a4987c.tar.gz` (sha256 `c0e8c262b963066cbc66a109f09b0c4c35e22f02619da4ede4df99c88403c86e`). REA's subject digest for the directory is sha256 `ad836aa61515e3ddb230c1212fcaf73323d1000801a87f6b95a88fdc6f1cb187`. This is the application source, with no `node_modules` and no ASAR.
- Question: How does this Electron app start, and how do its demos reach the main process?

The VS Code release download is a much larger packaged application. This MIT sample is small enough to keep the evidence bundle in the repository. VS Code itself was not analysed.

## How it is built

The selected workflow was static JavaScript application analysis:

```bash
node scripts/rea.mjs analyze-javascript-application <extracted-directory> --json
```

What that evidence shows:

- The artifact is a directory. `package.json` is observed as name `electron-api-demos`, version `2.0.2`, main `main.js`.
- The package loads `main.js` as the Electron main entry. Resolution status is `resolved`, mechanism `package.json:main`, confidence high.
- `main.js` is a CommonJS module with seven import relationships. Exact external requires are `electron` (`app` and `BrowserWindow`), `path`, `glob`, `electron-log`, `update-electron-app`, and `devtron`. A further require has expression `require(file)`, a null specifier, and a null resolved path.
- One `BrowserWindow` call is observed in `main.js` at line 35, columns 17-49. Its options status and web-preferences status are both `dynamic`. The web-preferences list is empty, the preload path is null, and `absence_means_default` is false.
- The Electron boundary summary counts one browser window, zero explicit web preferences, zero preload entrypoints, zero contextBridge APIs, and zero sender-validation observations. IPC counts are 30 operations, 18 literal channels, 12 renderer transmissions, 7 renderer listeners, and 11 main handlers. Every literal renderer transmission is paired. Dynamic channel operations and unpaired literal transmissions are zero.
- Literal channels, each observed on at least one side: `asynchronous-message`, `asynchronous-reply`, `factorial-computed`, `get-app-path`, `got-app-path`, `information-dialog-selection`, `ondragstart`, `open-error-dialog`, `open-file-dialog`, `open-information-dialog`, `put-in-tray`, `remove-tray`, `save-dialog`, `saved-file`, `selected-directory`, `show-context-menu`, `synchronous-message`, `tray-removed`.
- Inventory statistics: 79 relevant files, 54 parsed JavaScript files, 427872 text bytes, 6883 visited AST nodes, 251 findings, 0 parse failures, 0 nested ASAR containers, 0 integrity contradictions.
- Application-graph coverage is partial and was not truncated. The semantic graph records 1800 unknowns. Its coverage status is unknown, with partial call-flow and boundary families.

## Evidence

| Evidence ID                                                           | Workflow                         | What it shows                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ev_8951a3509c13338ea85576cab2e8a02ff7611dab6ed4554ac4e7cb277c4a991a` | `analyze-javascript-application` | Directory inventory, package entry, `main.js` requires, one dynamic-option `BrowserWindow`, and the literal IPC channels above. Authority `shipped-artifact`, confidence `derived`, predicate `rea.javascript-application-analysis`. |

The exported bundle is `evidence-bundle.canonical.json` in this directory. Leave that file as `rea evidence-export` wrote it. It holds one record and the same Evidence ID.

## Inferences

- The demos are organised as named IPC channels between renderer scripts and main-process listeners, with a paired send for every literal renderer transmission in this evidence. That uses the IPC summary and the channel observations on `ev_8951a3509c13338ea85576cab2e8a02ff7611dab6ed4554ac4e7cb277c4a991a`.
- `require(file)` is the static trace of demo loading. The target file is unresolved, so the graph does not prove which modules run. The `main-process/` tree is present in the inventory, which is consistent with demos living beside the entry, and it does not prove the glob that selects them.
- `update-electron-app`, `electron-log`, and `devtron` are startup imports of `main.js`. Their packages are external to this directory, so this evidence does not show what those modules do when required.

## Unknowns

- The `BrowserWindow` options, including any `webPreferences`, are dynamic. Empty preferences here do not mean the defaults are in force.
- The receiver of the `requestSingleInstanceLock` property read in `main.js` (line 77, columns 2-31) is unresolved. The semantic graph marks that read `unknown-coverage`. A single-instance lock is not established.
- External packages named by `main.js` are not in the analysed directory.
- No Electron process was launched, so window creation, IPC delivery, and the updater were not observed at runtime.
- The semantic graph left 1800 values unknown. Missing findings do not establish absence; the evidence limitations say the same for Electron relationships and runtime registration.

## Ideas we can adopt

- Resolve the Electron entry from `package.json` `main` and keep that file a small CommonJS shell. Evidence: the resolved `package.json:main` load in `ev_8951a3509c13338ea85576cab2e8a02ff7611dab6ed4554ac4e7cb277c4a991a`.
- Give each demo a literal IPC channel name, and pair each renderer send with a main listener. The evidence shows 18 literal channels and zero unpaired literal renderer transmissions.
- Write `webPreferences` as an object literal. This app's window options were dynamic, so the analysis could not say which preferences were set.

## Plan to build our own version

1. Start from an MIT-licensed shell: `package.json` with `main` set to one CommonJS file, and a local HTML page for the window.
2. Construct one `BrowserWindow` with a literal `webPreferences` object. Decide context isolation and preload in that object so a later static analysis can see them.
3. Register demo modules with explicit imports. Keep a dynamic `require(file)` out of the entry so the module list is part of the graph.
4. Define IPC channels as string literals. Each renderer message gets a matching main-process handler.
5. Treat logging and auto-update as separate modules that the shell may omit. Their behaviour needs its own evidence; this bundle only shows that `main.js` requires them.
6. Record the licence in the investigation report, export the evidence bundle, and keep the Evidence ID next to any behaviour we copy.
