import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import ipaddr from "ipaddr.js";
import { MAX_FILE_BYTES } from "./documents";

export function publicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("请输入完整的 http 或 https 公开网址。"); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error("仅支持不含登录凭据、使用标准端口的公开 http/https 网址。");
  if (host === "localhost" || /\.(localhost|local|internal)$/.test(host) || (!host.includes(".") && !isIP(host))) throw new Error("不能抓取本机或内网地址。");
  if (isIP(host) && !isPublicAddress(host)) throw new Error("不能抓取本机、内网或保留地址。");
  return url;
}

export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}
type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export async function publicAddresses(url: URL, resolve: Resolver = host => dns.lookup(host, { all: true })) {
  const host = publicUrl(url.href).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error("网址解析到内网或保留地址，不能抓取。");
  return addresses;
}
export type WebResponse = { url: string; status: number; headers: Record<string, string>; bytes: Buffer };

// 固定已验证的 DNS 结果；浏览器子请求也走这里，不能重新解析后连接到内网。
export async function readPublicResponse(value: string, signal: AbortSignal, maxBytes = MAX_FILE_BYTES): Promise<WebResponse> {
  const url = publicUrl(value);
  const addresses = await publicAddresses(url);
  signal.throwIfAborted();
  const address = addresses.find(a => a.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(url, {
      agent: false, signal,
      headers: { "User-Agent": "Shenbaotong/0.1 (public competition document reader)", "Accept": "*/*", "Accept-Encoding": "identity" },
      lookup: (_host, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      if (Number(response.headers["content-length"]) > maxBytes) { req.destroy(new Error("网页或附件超过10MB，请拆分或手动上传。")); return; }
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) req.destroy(new Error("网页或附件超过10MB，请拆分或手动上传。"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", async () => {
        try {
          const headers: Record<string, string> = {};
          for (const [key, val] of Object.entries(response.headers)) if (val !== undefined) headers[key] = Array.isArray(val) ? val.join(", ") : val;
          let bytes: Buffer = Buffer.concat(chunks);
          const encoding = headers["content-encoding"]?.toLowerCase();
          const decoder = encoding === "gzip" ? gunzipSync : encoding === "br" ? brotliDecompressSync : encoding === "deflate" ? inflateSync : null;
          if (decoder) bytes = decoder(bytes, { maxOutputLength: maxBytes });
          if (bytes.length > maxBytes) throw new Error("网页或附件超过10MB，请拆分或手动上传。");
          delete headers["content-encoding"]; delete headers["content-length"]; delete headers["set-cookie"];
          resolve({ url: url.href, status: response.statusCode ?? 500, headers, bytes });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error("网站响应超时，请稍后重试。")));
    req.on("error", reject); req.end();
  });
}

export async function readPublicPage(value: string, signal: AbortSignal, reader = readPublicResponse): Promise<WebResponse> {
  let current = publicUrl(value).href;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await reader(current, signal);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      current = publicUrl(new URL(response.headers.location, current).href).href;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`网站返回 ${response.status}，请检查网址，或改用上传文件、粘贴正文。`);
    return response;
  }
  throw new Error("网页跳转次数过多，请使用最终通知页面的网址。");
}
