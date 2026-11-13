#!/usr/bin/env node
/**
 * scripts/ios/patch-runtime-config.mjs
 *
 * 把 iOS 原生壳要用的后端地址写进 dist/runtime-config.js。
 * 源码里的 public/runtime-config.js 只有空占位（overrides 全为空串），构建产物拷进
 * ios/App/App/public 之前用这个脚本按环境变量填入真实地址，改动不回到仓库里。
 *
 * 用法：
 *   node scripts/ios/patch-runtime-config.mjs --dist dist
 *   FOLIA_NETEASE_API_BASE=... node scripts/ios/patch-runtime-config.mjs
 *
 * 环境变量（也接受同名 VITE_ 前缀，方便和 .env 复用）：
 *   FOLIA_NETEASE_API_BASE | VITE_NETEASE_API_BASE
 *   FOLIA_KUGOU_API_BASE   | VITE_KUGOU_API_BASE
 *   FOLIA_QQ_API_BASE      | VITE_QQ_API_BASE
 *   FOLIA_LYRIC_PROXY_BASE | VITE_LYRIC_PROXY_BASE
 *   FOLIA_FORCE_NATIVE=1   → 无条件写入 platform，用于在桌面浏览器里检查原生分支样式
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const distIndex = args.indexOf('--dist');
const distDir = path.resolve(distIndex >= 0 && args[distIndex + 1] ? args[distIndex + 1] : 'dist');
const target = path.join(distDir, 'runtime-config.js');

const readEnv = (...names) => {
    for (const name of names) {
        const value = process.env[name];
        if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    return '';
};

const overrides = {
    neteaseApiBase: readEnv('FOLIA_NETEASE_API_BASE', 'VITE_NETEASE_API_BASE'),
    kugouApiBase: readEnv('FOLIA_KUGOU_API_BASE', 'VITE_KUGOU_API_BASE'),
    qqApiBase: readEnv('FOLIA_QQ_API_BASE', 'VITE_QQ_API_BASE'),
    lyricProxyBase: readEnv('FOLIA_LYRIC_PROXY_BASE', 'VITE_LYRIC_PROXY_BASE'),
};

const serialized = JSON.stringify(overrides, null, 4).replace(/\n/g, '\n    ');
const script = `// 由 scripts/ios/patch-runtime-config.mjs 生成，请勿手改。
// 原生壳启动时读这里的地址；空串表示沿用构建时的 import.meta.env 或相对路径。
window.__FOLIA_RUNTIME_CONFIG__ = {
    ...(window.__FOLIA_RUNTIME_CONFIG__ || {}),
};
window.__FOLIA_RUNTIME_CONFIG__.iosOverrides = ${serialized};
`;

await fs.mkdir(distDir, { recursive: true });
await fs.writeFile(target, script, 'utf8');

const filled = Object.entries(overrides).filter(([, value]) => value !== '');
if (filled.length === 0) {
    console.log('[ios] runtime-config.js 已写入，但没有任何后端地址：网易云/酷狗/QQ 需要在应用内配置，或重跑本脚本并带上 FOLIA_*_API_BASE。');
} else {
    for (const [key, value] of filled) console.log(`[ios] ${key} = ${value}`);
}
