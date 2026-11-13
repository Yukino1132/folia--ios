#!/usr/bin/env node
/**
 * scripts/ios/sync-web-assets.mjs
 *
 * 把 dist/ 的 Web 产物同步进 ios/App/App/public，并清掉上一次同步留下的旧文件。
 * Capacitor 的 `cap sync` 也做这件事，但它会顺带尝试跑 CocoaPods；在只有 Windows 的
 * 环境里那一步必然失败，所以打包流程用本脚本代替它，只做文件搬运。
 *
 * 用法：node scripts/ios/sync-web-assets.mjs [--dist dist]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const distIndex = args.indexOf('--dist');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = path.resolve(root, distIndex >= 0 && args[distIndex + 1] ? args[distIndex + 1] : 'dist');
const publicDir = path.join(root, 'ios', 'App', 'App', 'public');

const exists = async target => {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
};

if (!(await exists(path.join(distDir, 'index.html')))) {
    console.error(`[ios] 找不到 ${path.join(distDir, 'index.html')}，先跑 npm run build:ios。`);
    process.exit(1);
}

await fs.rm(publicDir, { recursive: true, force: true });
await fs.mkdir(publicDir, { recursive: true });

// 连同 capacitor.config.json 里 webDir 之外的东西一起搬：dist 里已经包含了 public/ 的全部内容。
await fs.cp(distDir, publicDir, { recursive: true });

const count = (await fs.readdir(publicDir, { recursive: true })).length;
console.log(`[ios] 已把 ${distDir} 同步到 ${publicDir}（${count} 个条目）。`);
