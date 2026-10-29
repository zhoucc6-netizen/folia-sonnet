// shared/geminiEndpoint.mjs
// Gemini 的 generateContent 端点：把设置里填的「API 请求地址」变成真正要打的那条 URL。
// 渲染进程用这一份，Electron 主进程用 shared/geminiEndpoint.cjs，两份内容须保持一致
// （test/unit/shared/geminiEndpoint.test.ts 对照两份的输出）。
//
// 为什么要可配：官方域名在不少网络里根本连不上，用户会自己反代一层（比如把
// https://generativelanguage.googleapis.com 反代到 https://apig.tangbot.xyz）。
// 地址写死的话，填了 Key 也永远发不出去 —— 而报错只会是一次「请求失败」，看不出是域名的问题。

/**
 * 默认地址：官方域名的反向代理。
 *
 * 它同时也是「设置里留空」时的回落值 —— 空字符串永远解析成这一个，改这里就等于改所有人的默认。
 */
export const GEMINI_DEFAULT_API_BASE = 'https://apig.tangbot.xyz';

/** 模型是宿主决定的（设置里没有 Gemini 的模型字段），端点靠它拼出来。 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3-flash-preview';

/**
 * 用户在输入框里粘进来的东西要先清一遍。
 *
 * 空格与中文冒号是最常见的两种：手抄地址时前后带空格、中文输入法打出「：」，
 * 两者都会让 `new URL` 抛 Invalid URL —— 不在这里去掉的话，填了自定义地址的人
 * 得到的是「没生效」，而真正的原因是构造 URL 时就炸了。
 */
const sanitizeGeminiUrlInput = (raw) => String(raw ?? '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/[：]/g, ':');

/**
 * 完整的 generateContent 端点。
 *
 * 三种填法都接受：
 *  - 留空 → 默认反代地址；
 *  - 只填域名 / 前缀（https://apig.tangbot.xyz）→ 按官方路径补成
 *    `/v1beta/models/<模型>:generateContent`。反代通常把整条路径一起反代，所以
 *    填官方域名 https://generativelanguage.googleapis.com 也能回到官方；
 *  - 已经填到动作名（.../models/xxx:generateContent）→ 原样用，不再动它。
 *
 * 解析不出来一律回落默认，不抛错：地址是用户随手填的，一个拼错的地址不该变成
 * 「AI 不可用」，回落到默认至少还能试一次。
 */
export function resolveGeminiGenerateContentUrl(rawUrl, model) {
  const modelName = String(model ?? '').trim() || GEMINI_DEFAULT_MODEL;
  const fallback = `${GEMINI_DEFAULT_API_BASE}/v1beta/models/${modelName}:generateContent`;
  const raw = sanitizeGeminiUrlInput(rawUrl);
  if (!raw) return fallback;
  // 已经是一整个 generateContent 端点。
  if (/:generateContent(?:[?#]|$)/.test(raw)) return raw;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return fallback;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;

  const path = parsed.pathname.replace(/\/+$/, '');
  // 填到「/models/<模型>」这一级就只补动作名，其余按官方路径补全。
  parsed.pathname = /\/models\/[^/]+$/.test(path)
    ? `${path}:generateContent`
    : `${path}/v1beta/models/${modelName}:generateContent`;
  return parsed.toString();
}

/**
 * 同一个清洗，导出给「测试连接」那条路用。
 *
 * 主进程校验地址时会 `new URL` 一遍，不清洗的话，这里放行、那边拒绝 ——
 * 表现就是「生成能跑通，测试连接却说地址不合法」。
 */
export const sanitizeApiUrlInput = sanitizeGeminiUrlInput;
