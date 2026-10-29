// ci/checkVersionPolicy.ts
// 版本约束检查：CI 的 version-policy 任务和本地 npm run check:versions 跑的是这一份。
// 规则来源：AGENTS.md 的「依赖」一节，以及 src/services/onlineMusic/UPSTREAMS.md 里每个平台的「版本」段。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 import.meta.url 而不是 import.meta.dirname：这份文件也会被 vitest 打包执行，那里只保证有 url。
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface PlatformDep {
    name: string;
    // 有 Docker 部署的平台，根目录与 deploy/docker 里那份必须写同一个版本；没有就为 null。
    docker: string | null;
}

const PLATFORM_DEPS: PlatformDep[] = [
    { name: '@neteasecloudmusicapienhanced/api', docker: 'deploy/docker/netease-api/package.json' },
    { name: '@yakult-green-tea/qq-music-api', docker: 'deploy/docker/qq-api/package.json' },
    { name: 'kugoumusicapi', docker: 'deploy/docker/kugou-api/package.json' },
    // 只有网页版调用，没有 Docker 部署，钉在根 package.json 即可。
    { name: 'bodian-music-api', docker: null },
    { name: 'qishui-music-api', docker: null },
    { name: 'youtubei.js', docker: null },
    { name: 'googlevideo', docker: null },
    { name: 'bgutils-js', docker: null },
];

// android/app/build.gradle 的 versionCodeOf 只认 A.B.C 或 A.B.C.D。
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/;

export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    build: number;
}

export function parseVersion(version: string): ParsedVersion | null {
    const matched = VERSION_PATTERN.exec(String(version).trim());
    if (!matched) return null;
    return {
        major: Number(matched[1]),
        minor: Number(matched[2]),
        patch: Number(matched[3]),
        build: matched[4] ? Number(matched[4]) : 0,
    };
}

// 与 android/app/build.gradle 同一套算法：patch 和 build 超过 99 会被截断。
export function versionCodeOf(version: string): number {
    const parsed = parseVersion(version);
    if (!parsed) return 0;
    return parsed.major * 1000000
        + parsed.minor * 100000
        + Math.min(parsed.patch, 99) * 100
        + Math.min(parsed.build, 99);
}

export function versionNumberIssues(version: string): string[] {
    const parsed = parseVersion(version);
    if (!parsed) return [`版本号 ${version} 不是 A.B.C 或 A.B.C.D`];
    const issues: string[] = [];
    // 截断后的 versionCode 会和上一版相同，装了新版系统也认为没变（build.gradle 里有同样的注释）。
    if (parsed.patch > 99) issues.push(`patch ${parsed.patch} 超过 99：versionCode 会被截断，升级 minor`);
    if (parsed.build > 99) issues.push(`build ${parsed.build} 超过 99：versionCode 会被截断`);
    return issues;
}

// 范围写法（^ ~ >= * latest）让安装结果随发布漂移；平台库一律不接受。
export function isPinnedSpec(spec: unknown): boolean {
    const value = String(spec ?? '').trim();
    if (!value) return false;
    if (/^(file|link|workspace):/.test(value)) return false;
    return !/^[\^~>=<*]|^latest$/.test(value);
}

export function checkVersionPolicy(root: string = repoRoot): string[] {
    const failures: string[] = [];
    const readJson = (relative: string): any => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    const exists = (relative: string): boolean => fs.existsSync(path.join(root, relative));

    const pkg = readJson('package.json');
    const dependencies: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

    // 1. 平台依赖：根目录钉死，且与 Docker 部署那份一致。
    for (const dep of PLATFORM_DEPS) {
        const spec = dependencies[dep.name];
        if (!spec) {
            failures.push(`缺少平台依赖 ${dep.name}（根 package.json）`);
            continue;
        }
        if (!isPinnedSpec(spec)) {
            failures.push(`${dep.name} 必须钉死版本，现在是 ${spec}`);
            continue;
        }
        if (!dep.docker) continue;
        if (!exists(dep.docker)) {
            failures.push(`找不到部署用的 ${dep.docker}`);
            continue;
        }
        const deployed = readJson(dep.docker);
        const deployedSpec = { ...deployed.dependencies, ...deployed.devDependencies }[dep.name];
        if (!deployedSpec) failures.push(`${dep.docker} 里没有 ${dep.name}：两处版本必须一起改`);
        else if (deployedSpec !== spec) failures.push(`${dep.name} 两处版本不一致：根 ${spec}，${dep.docker} ${deployedSpec}`);
    }

    // 2. Node 版本：.nvmrc、engines.node、所有 workflow 的 node-version 一致。
    const nvmrc = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
    const engine = /^>=\s*(\d+)/.exec(pkg.engines?.node ?? '');
    if (!engine) failures.push('package.json 的 engines.node 必须写成 >=N 的形式');
    else if (engine[1] !== nvmrc) failures.push(`.nvmrc 是 ${nvmrc}，engines.node 却是 ${pkg.engines.node}`);
    const workflowDir = path.join(root, '.github', 'workflows');
    for (const file of fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))) {
        const content = fs.readFileSync(path.join(workflowDir, file), 'utf8');
        for (const matched of content.matchAll(/node-version:\s*['"]?([\w.]+)['"]?/g)) {
            if (matched[1] !== nvmrc) failures.push(`.github/workflows/${file} 用的是 Node ${matched[1]}，与 .nvmrc 的 ${nvmrc} 不一致`);
        }
    }

    // 3. 版本号：格式、Android 的 versionCode 推导、与锁文件顶层版本一致。
    failures.push(...versionNumberIssues(pkg.version));
    if (exists('package-lock.json')) {
        const lock = readJson('package-lock.json');
        const lockVersion = lock.packages?.['']?.version ?? lock.version;
        if (lockVersion !== pkg.version) failures.push(`package-lock.json 的版本是 ${lockVersion}，与 package.json 的 ${pkg.version} 不一致（跑一次 npm install）`);
    }

    return failures;
}

function main(): void {
    const failures = checkVersionPolicy();
    if (failures.length > 0) {
        console.error(`版本约束检查失败（${failures.length} 项）：`);
        for (const failure of failures) console.error(`- ${failure}`);
        process.exitCode = 1;
        return;
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    console.log(`版本约束检查通过：${pkg.version} → versionCode ${versionCodeOf(pkg.version)}；平台依赖 ${PLATFORM_DEPS.length} 个钉死，Docker 部署版本一致`);
}

// 只有直接 `node ci/checkVersionPolicy.ts` 才跑检查；被单测 import 时不产生副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
