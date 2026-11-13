// scripts/ios/build-ipa.mjs
// 在 macOS 上把 Capacitor iOS 工程打成可自签的 .ipa（未签名，或带证书直签）。
// 用法：
//   node scripts/ios/build-ipa.mjs                 未签名 IPA（build/ios/Folia.ipa）
//   node scripts/ios/build-ipa.mjs --skip-build    复用已有 xcarchive
//   FORCE_SIGN=1 DEVELOPMENT_TEAM=XXX node scripts/ios/build-ipa.mjs
// 说明：Windows / Linux 上没有 xcodebuild，脚本会直接退出并提示去 macOS 执行。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const appDir = path.join(root, 'ios', 'App');
const outDir = path.join(root, 'build', 'ios');
const archivePath = path.join(outDir, 'App.xcarchive');
const ipaPath = path.join(outDir, 'Folia.ipa');
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');

const log = message => console.log(`[ipa] ${message}`);

const run = (command, commandArgs, options = {}) => {
    log(`$ ${command} ${commandArgs.join(' ')}`);
    execFileSync(command, commandArgs, { stdio: 'inherit', cwd: appDir, ...options });
};

const fail = message => {
    console.error(`[ipa] ${message}`);
    process.exit(1);
};

const which = name => {
    try {
        execFileSync('/usr/bin/which', [name], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

if (process.platform !== 'darwin') {
    fail(`打包 IPA 需要 macOS + Xcode；当前是 ${process.platform}。Web 产物已同步到 ios/App/App/public，请把仓库拷到 Mac 上按 ios/BUILD-IPA.md 继续。`);
}
if (!which('xcodebuild')) fail('找不到 xcodebuild，请先安装 Xcode 并执行 xcode-select --install / sudo xcode-select -s /Applications/Xcode.app');

fs.mkdirSync(outDir, { recursive: true });

// ---- 1. Pods ----
if (!skipBuild) {
    if (which('pod')) {
        run('pod', ['install', '--repo-update']);
    } else if (fs.existsSync(path.join(appDir, 'Pods'))) {
        log('没有 CocoaPods，沿用已有的 Pods 目录');
    } else {
        fail('没有 CocoaPods 且没有 Pods 目录；请先 sudo gem install cocoapods');
    }
}

// ---- 2. Archive ----
if (skipBuild) {
    if (!fs.existsSync(archivePath)) fail(`--skip-build 需要已有的 ${archivePath}`);
    log(`复用 ${archivePath}`);
} else {
    const signing = process.env.FORCE_SIGN === '1'
        ? [
            '-allowProvisioningUpdates',
            `DEVELOPMENT_TEAM=${process.env.DEVELOPMENT_TEAM ?? ''}`,
            `CODE_SIGN_IDENTITY=${process.env.CODE_SIGN_IDENTITY ?? 'Apple Development'}`,
            ...(process.env.PROVISIONING_PROFILE_SPECIFIER ? [`PROVISIONING_PROFILE_SPECIFIER=${process.env.PROVISIONING_PROFILE_SPECIFIER}`] : []),
        ]
        : [
            '-allowProvisioningUpdates',
            'CODE_SIGNING_ALLOWED=NO',
            'CODE_SIGNING_REQUIRED=NO',
            'CODE_SIGN_IDENTITY=',
            'EXPANDED_CODE_SIGN_IDENTITY=',
        ];
    run('xcodebuild', [
        '-workspace', 'App.xcworkspace',
        '-scheme', 'App',
        '-configuration', 'Release',
        '-destination', 'generic/platform=iOS',
        '-archivePath', archivePath,
        ...signing,
        'archive',
    ]);
}

// ---- 3. Payload → ipa ----
const appInArchive = path.join(archivePath, 'Products', 'Applications', 'App.app');
if (!fs.existsSync(appInArchive)) fail(`Archive 里没有 App.app：${appInArchive}`);

const payloadDir = path.join(outDir, 'Payload');
fs.rmSync(payloadDir, { recursive: true, force: true });
fs.mkdirSync(payloadDir, { recursive: true });
execFileSync('cp', ['-R', appInArchive, path.join(payloadDir, 'App.app')], { stdio: 'inherit' });

if (fs.existsSync(ipaPath)) fs.rmSync(ipaPath);
execFileSync('zip', ['-qry', ipaPath, 'Payload'], { cwd: outDir, stdio: 'inherit' });

const sizeMb = (fs.statSync(ipaPath).size / 1024 / 1024).toFixed(1);
log(`完成：${ipaPath}（${sizeMb} MB）`);
if (process.env.FORCE_SIGN !== '1') {
    log('这是未签名包，可用 Sideloadly / AltStore / TrollStore 等工具注入你自己的证书安装。');
}
