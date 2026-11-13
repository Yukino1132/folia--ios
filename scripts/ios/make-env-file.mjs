#!/usr/bin/env node
/**
 * scripts/ios/make-env-file.mjs
 *
 * 生成 ios/.xcode.env.local，把 CocoaPods 与 Xcode 构建阶段要用的 node 路径写死。
 * Xcode 的 Run Script 阶段（Capacitor 的 [CP] Embed Pods Frameworks 与 cordova 检查）
 * 只继承了登录 shell 的 PATH，从 Finder 或 CI 起的 xcodebuild 常常找不到 nvm / fnm
 * 装的 node，表现为 "node: command not found"。这里把当前可用的 node 绝对路径写进去，
 * 工程本身就不需要再依赖开发机的 shell 配置。
 *
 * 用法：node scripts/ios/make-env-file.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = path.join(root, 'ios', 'App', '.xcode.env.local');
const nodePath = process.execPath;

await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(
    target,
    `# 由 scripts/ios/make-env-file.mjs 生成，请勿手改。\n# Xcode 的 Run Script 阶段从这里取 node。\nexport NODE_BINARY=${JSON.stringify(nodePath)}\n`,
    'utf8',
);
console.log(`[ios] 已写入 ${target}`);
console.log(`[ios] NODE_BINARY = ${nodePath}`);
console.log('[ios] 如果最终在 macOS 上构建，请在那台机器上重跑一次本脚本，路径才是该机的 node。');
