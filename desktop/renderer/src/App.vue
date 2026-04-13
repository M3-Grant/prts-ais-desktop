<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { marked } from "marked";
import avatarRC from './assets/R-C.jpg';
import avatarUser from './assets/OIP-C.jpg';

marked.use({
  gfm: true,
  breaks: true,
});

/** 与 main 的 TUDOU_TOOL_JSON_MASK 对应：VITE_TOOL_JSON_MASK=true|1 才启用剥离/拦截提示；默认 false 显示原文 */
const TOOL_JSON_OUTPUT_MASKING = ["true", "1"].includes(
  String(import.meta.env.VITE_TOOL_JSON_MASK || "").toLowerCase(),
);

/** 与主进程 `summarizePromptDebug` 返回结构对齐 */
type DiagDebug = {
  length?: number;
  hasWorkspaceContext?: boolean;
  hasConversationHistory?: boolean;
  hasTargetFileContext?: boolean;
  targetFileSummary?: string;
  hasModelfileRef?: boolean;
  preview?: string;
  bridgeMode?: string;
  ollamaInteraction?: "priestess" | "assistant";
  cliStderrPreview?: string;
  cliExitCode?: number | null;
  cliCwd?: string;
};


type MessageRole = "user" | "assistant" | "error";

type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  responseState?: "streaming" | "complete" | "abnormal";
  responseReason?: string;
};

type PromptHistoryItem = {
  role: "user" | "assistant";
  text: string;
};

const DEFAULT_ASSISTANT_WELCOME = "好久不见，博士，希望你仍然没有忘记我。";
const CLI_MODE_WELCOME = "助手模式已就绪，可直接描述需要修改或分析的工程任务。";

type DesktopSettings = {
  MODEL_PROVIDER?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  API_TIMEOUT_MS?: string;
  ASSISTANT_AVATAR?: string;
};

const isBusy = ref(false);
const sessionId = ref("");
const workspacePath = ref("");
const inputText = ref("");
const showSettings = ref(true);
const pathExpanded = ref(false);
const settingsCollapsed = ref(false);
const heroCollapsed = ref(false);
const heroLaunching = ref(true);
const launchUIVisible = ref(false);
const heroPulse = ref(false);
const heroAnimating = ref<"" | "expand" | "shrink">("");
const settingsAnimating = ref<"" | "expand" | "shrink">("");
const noticeText = ref("");
const noticeType = ref<"ok" | "warn">("ok");
/** 最近一次请求的解析诊断（表格展示） */
const lastDiagnostics = ref<DiagDebug | null>(null);
const messages = ref<ChatMessage[]>([]);
const messagesEl = ref<HTMLElement | null>(null);
const currentAssistantId = ref("");
/** 重新输出时从 history 中排除的旧助手气泡 id，成功且「完整」后从列表删除 */
const regenerateExcludeAssistantId = ref<string | null>(null);
const assistantAvatar = ref("");
const userAvatar = ref("");

const runMode = ref<"cloud" | "ollama">("cloud");
const apiKey = ref("");
const selectedModelId = ref("");
const selectedModelProvider = ref<"openrouter" | "anthropic" | "">("");
const ollamaBaseUrl = ref("http://127.0.0.1:11434");
const ollamaModel = ref("");
/** Ollama 下：普瑞赛斯=直连人格无工程注入；助手=CLI 全功能无锁人格 */
const ollamaPersonaMode = ref<"priestess" | "assistant">("priestess");
const cloudModels = ref<Array<{ id: string; name: string; provider: string }>>([]);
const loadingModels = ref(false);

const GLASS_KEYS = {
  banner: "tudou-glass-banner",
  chat: "tudou-glass-chat",
  sidebar: "tudou-glass-sidebar",
} as const;

function readStoredGlass(key: string, fallback: number) {
  try {
    const raw = localStorage.getItem(key);
    const n = Number.parseInt(raw || "", 10);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  } catch {
    /* ignore */
  }
  return fallback;
}

/** 0–100：毛玻璃强度；调低时叠色与模糊同步减弱，背后壁纸更清晰（不会单独「发白」） */
const glassBannerOpacity = ref(52);
const glassChatOpacity = ref(42);
const glassSidebarOpacity = ref(58);

const pageGlassStyle = computed(() => {
  const sb = glassBannerOpacity.value / 100;
  const sc = glassChatOpacity.value / 100;
  const ss = glassSidebarOpacity.value / 100;
  return {
    "--glass-banner-strength": String(sb),
    "--glass-chat-strength": String(sc),
    "--glass-sidebar-strength": String(ss),
    "--glass-banner-blur": `${Math.round(sb * 28)}px`,
    "--glass-chat-blur": `${Math.round(sc * 24)}px`,
    "--glass-sidebar-blur": `${Math.round(ss * 24)}px`,
  };
});

const settings = reactive<Required<DesktopSettings>>({
  MODEL_PROVIDER: "anthropic",
  ANTHROPIC_BASE_URL: "",
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_MODEL: "",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "",
  OLLAMA_BASE_URL: "",
  OLLAMA_MODEL: "",
  API_TIMEOUT_MS: "3000000",
  ASSISTANT_AVATAR: "",
});

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function roleLabel(role: MessageRole) {
  if (role === "user") return "你";
  if (role === "assistant") return "助手";
  return "错误";
}

function addMessage(role: MessageRole, text: string, meta?: Partial<ChatMessage>) {
  const item: ChatMessage = { id: makeId(), role, text, ...(meta || {}) };
  messages.value.push(item);
  return item.id;
}

/** 任意新消息或内容更新后滚到底部（用户 / 助手 / 错误等） */
function scrollMessagesToEnd() {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = messagesEl.value;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  });
}

function responseStateLabel(m: ChatMessage) {
  if (m.role !== "assistant") return "";
  if (m.responseState === "streaming") return "生成中";
  if (m.responseState === "abnormal") return "异常";
  return "完整";
}

function buildPromptHistory(limit = 12): PromptHistoryItem[] {
  const excludeAssistantId = regenerateExcludeAssistantId.value;
  const normalized = messages.value
    .filter((m) => {
      if (excludeAssistantId && m.role === "assistant" && m.id === excludeAssistantId) return false;
      return (m.role === "user" || m.role === "assistant") && Boolean((m.text || "").trim());
    })
    .filter((m) => {
      const t = (m.text || "").trim();
      if (m.role === "assistant" && /^新会话已创建[:：]/.test(t)) return false;
      return true;
    })
    .map((m) => ({
      role: m.role as "user" | "assistant",
      text: m.text.trim(),
    }));
  if (normalized.length <= limit) return normalized;
  return normalized.slice(-limit);
}

function showNotice(text: string, type: "ok" | "warn" = "ok") {
  noticeText.value = text;
  noticeType.value = type;
}

function getToolArgsClient(j: Record<string, unknown>): unknown {
  if (j.arguments != null && typeof j.arguments === "object") return j.arguments;
  if (j.input != null && typeof j.input === "object") return j.input;
  return null;
}

function isToolLikeClient(j: Record<string, unknown>): boolean {
  return Boolean(j && typeof j.name === "string" && getToolArgsClient(j));
}

function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (t.length < 10 || t[0] !== "{") return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

function tryParseToolCallJsonClient(s: string): Record<string, unknown> | null {
  const j = tryParseJsonObject(s);
  return j && isToolLikeClient(j) ? j : null;
}

function extractProseFromToolPayloadClient(obj: Record<string, unknown>, depth = 0): string {
  if (!obj || typeof obj !== "object" || depth > 4) return "";
  const argsRaw = getToolArgsClient(obj);
  if (argsRaw && typeof argsRaw === "object") {
    const fromArgs = extractProseFromToolPayloadClient(argsRaw as Record<string, unknown>, depth + 1);
    if (fromArgs.length > 0) return fromArgs;
  }

  const skip = new Set([
    "name",
    "arguments",
    "input",
    "type",
    "id",
    "tool_call_id",
    "tool_use_id",
    "partial",
    "index",
  ]);
  const preferKeys = [
    "explanation",
    "summary",
    "answer",
    "response",
    "message",
    "content",
    "assistant_response",
    "description",
    "reasoning",
    "thought",
    "preamble",
    "comment",
    "notes",
    "body",
    "text",
    "reply",
  ];
  for (const k of preferKeys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (typeof v === "string" && v.trim().length >= 4) return v.trim();
    }
  }
  let best = "";
  for (const [k, val] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    if (typeof val === "string") {
      const s = val.trim();
      if (s.length < 12) continue;
      if (/^\s*[\[{]/.test(s)) continue;
      if (/^[A-Za-z]:[\\/]/.test(s) && s.length < 260 && !/[\u4e00-\u9fff\u3000-\u303f]/.test(s)) continue;
      if (s.length > best.length) best = s;
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      const inner = extractProseFromToolPayloadClient(val as Record<string, unknown>, depth + 1);
      if (inner.length > best.length) best = inner;
    }
  }
  return best;
}

/** 与主进程 sanitize 对齐：优先保留 JSON 内的自然语言，再剥掉工具壳 */
function stripToolJsonForMarkdownDisplay(raw: string): string {
  let t = `${raw || ""}`;
  t = t.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (full, inner: string) => {
    const j = tryParseJsonObject(inner);
    if (!j || !isToolLikeClient(j)) return full;
    const prose = extractProseFromToolPayloadClient(j);
    return prose || "";
  });

  const tr = t.trim();
  if (tr.startsWith("{")) {
    const parsed = tryParseJsonObject(tr);
    if (parsed) {
      const prose = extractProseFromToolPayloadClient(parsed);
      if (prose) {
        return `${prose}\n\n*（同条回复中的工具调用 JSON 已省略。）*`;
      }
      if (isToolLikeClient(parsed)) return "";
    }
  }

  t = t.replace(
    /\{\s*"name"\s*:\s*"(read_file|glob_file_search|grep|list_dir|codebase_search|read|Write|write|Edit|edit|Bash|bash|Glob|glob|Grep|simplify)"\s*,[\s\S]*?"(?:arguments|input)"\s*:\s*\{[\s\S]*?\}\s*\}/gi,
    "",
  );

  const lines = t.split(/\r?\n/);
  const merged: string[] = [];
  for (const line of lines) {
    const j = tryParseToolCallJsonClient(line.trim());
    if (j) {
      const prose = extractProseFromToolPayloadClient(j);
      if (prose) merged.push(prose);
      continue;
    }
    merged.push(line);
  }
  return merged.join("\n").trim();
}

function renderAssistantMarkdown(raw: string) {
  const rawStr = `${raw || ""}`;
  const text = TOOL_JSON_OUTPUT_MASKING ? stripToolJsonForMarkdownDisplay(rawStr) : rawStr;
  if (!text.trim()) {
    if (TOOL_JSON_OUTPUT_MASKING) {
      return `<p class="bubble-tool-hint">本回复仅为工具调用 JSON，已隐藏显示。可改问「请用中文概括 README 要点」或确认本地 Claude CLI 是否已执行工具链。</p>`;
    }
    return "";
  }
  try {
    const out = marked.parse(text, { async: false });
    return typeof out === "string" ? out : "";
  } catch {
    return `<pre class="md-fallback">${escapeHtmlLite(text)}</pre>`;
  }
}

function escapeHtmlLite(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toggleOllamaPersonaSwitch() {
  ollamaPersonaMode.value = ollamaPersonaMode.value === "priestess" ? "assistant" : "priestess";
}

function inferProviderByModel(model: string) {
  if ((model || "").startsWith("openrouter/")) return "openrouter";
  return "anthropic";
}

function inferProviderByKey(key: string) {
  const k = (key || "").trim();
  if (k.startsWith("sk-or-")) return "openrouter";
  return "";
}

function resolveCloudProvider(model: string, key: string, selected: "openrouter" | "anthropic" | "") {
  const byKey = inferProviderByKey(key);
  if (byKey) return byKey as "openrouter" | "anthropic";
  if (selected) return selected;
  return inferProviderByModel(model) as "openrouter" | "anthropic";
}

function cloudBaseUrlByProvider(provider: "openrouter" | "anthropic") {
  return provider === "openrouter" ? "https://openrouter.ai/api" : "https://api.anthropic.com";
}

function applySettings(data?: DesktopSettings) {
  if (!data) return;
  settings.MODEL_PROVIDER = data.MODEL_PROVIDER || "anthropic";
  settings.ANTHROPIC_BASE_URL = data.ANTHROPIC_BASE_URL ?? "";
  settings.ANTHROPIC_API_KEY = data.ANTHROPIC_API_KEY ?? "";
  settings.ANTHROPIC_AUTH_TOKEN = data.ANTHROPIC_AUTH_TOKEN ?? "";
  settings.ANTHROPIC_MODEL = data.ANTHROPIC_MODEL ?? "";
  settings.ANTHROPIC_DEFAULT_SONNET_MODEL = data.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "";
  settings.ANTHROPIC_DEFAULT_HAIKU_MODEL = data.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "";
  settings.ANTHROPIC_DEFAULT_OPUS_MODEL = data.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "";
  settings.OLLAMA_BASE_URL = data.OLLAMA_BASE_URL ?? "";
  settings.OLLAMA_MODEL = data.OLLAMA_MODEL ?? "";
  settings.API_TIMEOUT_MS = data.API_TIMEOUT_MS ?? "3000000";

  runMode.value = settings.MODEL_PROVIDER === "ollama" ? "ollama" : "cloud";
  const cloudKey = settings.ANTHROPIC_API_KEY || settings.ANTHROPIC_AUTH_TOKEN || "";
  apiKey.value = cloudKey === "ollama-local" ? "" : cloudKey;
  selectedModelId.value = settings.ANTHROPIC_MODEL || "openrouter/auto";
  selectedModelProvider.value = "openrouter";
  ollamaBaseUrl.value = settings.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  ollamaModel.value = settings.OLLAMA_MODEL || "";
  assistantAvatar.value = data.ASSISTANT_AVATAR ?? "";
}

function displayPath(p: string) {
  if (!p) return '未选择';
  // Return full path and let CSS show the tail adaptively
  return p;
}

function displayDrive(p: string) {
  if (!p) return '';
  // Windows paths like C:\ or C:/ or C:\folder
  const m = p.match(/^([A-Za-z]:)/);
  if (m) return m[1].toUpperCase();
  // Unix-like: return root symbol
  if (p.startsWith('/')) return '/';
  return '';
}

async function openDriveBtn() {
  const desktopApi = window.desktopApi as any;
  const drive = displayDrive(workspacePath.value);
  if (!drive) {
    showNotice('未检测到有效磁盘路径', 'warn');
    return;
  }

  if (!desktopApi || typeof desktopApi.openDrive !== 'function') {
    console.warn('openDrive API not available on desktopApi');
    showNotice('桌面桥未提供打开磁盘功能，请重启应用或使用“打开项目”', 'warn');
    return;
  }

  try {
    const res = await desktopApi.openDrive(drive);
    if (!res?.ok) {
      showNotice(res?.error || '无法打开磁盘', 'warn');
    }
  } catch (err) {
    console.error('openDrive invocation failed', err);
    showNotice('打开磁盘失败: ' + (err?.message || String(err)), 'warn');
  }
}

function togglePathDisplay() {
  // simple toggle used by the UI; kept separate for clarity
  pathExpanded.value = !pathExpanded.value;
}

/*
  SPECIAL ALGORITHM MODULE: Adaptive theme extraction & generation
  - Purpose: read the page background color (computed) and derive a small palette
    for buttons and CTAs that ensures sufficient contrast and visual harmony.
  - Approach (pragmatic): parse computed RGB, convert to HSL, then shift
    lightness/saturation to produce button background, border and text colors.
  - Notes: kept lightweight and deterministic; added safety fallbacks.
*/
function parseRgbString(s) {
  // Accept formats: rgb(r,g,b), rgba(r,g,b,a)
  const m = (s || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToCss(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function computeAdaptiveColors(bgRgb) {
  // bgRgb: [r,g,b]
  const [h, s, l] = rgbToHsl(bgRgb[0], bgRgb[1], bgRgb[2]);

  // Special-case: near-white background -> use light-blue to pink pastel gradient
  const isNearWhite = bgRgb[0] > 250 && bgRgb[1] > 250 && bgRgb[2] > 250;
  if (isNearWhite) {
    // Pale blue to pale pink gradient that leans to white
    const btnBg = 'linear-gradient(90deg, rgba(220,240,255,0.95), rgba(255,240,245,0.95))';
    const btnBorder = 'rgba(190,215,245,0.7)';
    const btnText = 'rgba(14,34,54,0.85)'; // slightly desaturated dark blue for readability

    // Danger: pale red/pink
    const dangerBg = 'rgba(255,210,215,0.92)';
    const dangerBorder = 'rgba(230,140,150,0.75)';
    const dangerText = '#5a1a1a';

    return {
      btnBg,
      btnBorder,
      btnText,
      dangerBg,
      dangerBorder,
      dangerText,
    };
  }

  // Fallback: original HSL-shifted scheme
  // Decide whether background is light or dark
  const isLight = l > 0.6;
  // Primary button: shift towards more contrast
  let btnL = isLight ? clamp(l - 0.22, 0, 1) : clamp(l + 0.22, 0, 1);
  let btnS = clamp(s + 0.12, 0, 1);
  // use the same hue for harmony
  const btnRgb = hslToRgb(h, btnS, btnL);

  // Border: slightly darker/lighter than button
  let borderL = clamp(btnL + (isLight ? -0.06 : 0.06), 0, 1);
  const borderRgb = hslToRgb(h, clamp(btnS - 0.06, 0, 1), borderL);

  // Text color: high contrast against button
  const textColor = btnL > 0.5 ? 'rgba(20,14,19,0.95)' : '#f4e7de';

  // Danger color: use hue +120deg for distinction (wrap)
  const dangerHue = (h + 120) % 360;
  const dangerRgb = hslToRgb(dangerHue, clamp(s + 0.08, 0, 1), clamp(isLight ? 0.35 : 0.6, 0, 1));
  const dangerBorderRgb = hslToRgb(dangerHue, clamp(s, 0, 1), clamp(isLight ? 0.28 : 0.54, 0, 1));

  return {
    btnBg: rgbToCss(btnRgb),
    btnBorder: rgbToCss(borderRgb),
    btnText: textColor,
    dangerBg: `rgba(${dangerRgb[0]},${dangerRgb[1]},${dangerRgb[2]},0.9)`,
    dangerBorder: rgbToCss(dangerBorderRgb),
    dangerText: '#fde7e7',
  };
}

async function applyThemeFromBackground() {
  // Attempt order:
  // 1) computed style background-color of .page
  // 2) computed style background-image of .page -> sample image pixel average
  // 3) body/html background-color
  // 4) fallback dark
  try {
    const pageEl = document.querySelector('.page') || document.body;
    const cs = window.getComputedStyle(pageEl);

    let rgb = null;

    // 1) Try background-color
    const bgColor = cs && (cs.backgroundColor || cs.background) ? cs.backgroundColor : '';
    if (bgColor && bgColor !== 'transparent') {
      rgb = parseRgbString(bgColor);
      console.debug('applyThemeFromBackground: used page backgroundColor', bgColor, '->', rgb);
    }

    // 2) If no color, try background-image URL and sample it via canvas
    if (!rgb) {
      const bgImage = cs && cs.backgroundImage ? cs.backgroundImage : '';
      const m = bgImage && bgImage.match(/url\((?:"|')?(.*?)(?:"|')?\)/i);
      if (m && m[1]) {
        const url = m[1].trim();
        try {
          const img = new Image();
          // Ensure correct path resolution for relative assets
          img.src = url.startsWith('data:') ? url : new URL(url, window.location.href).href;
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
          const w = Math.min(32, img.naturalWidth || 32);
          const h = Math.min(32, img.naturalHeight || 32);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i+3] / 255;
            if (alpha < 0.5) continue;
            r += data[i]; g += data[i+1]; b += data[i+2]; count++;
          }
          if (count > 0) {
            r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
            rgb = [r, g, b];
            console.debug('applyThemeFromBackground: sampled image avg', rgb);
          }
        } catch (err) {
          console.warn('applyThemeFromBackground: failed sampling background image', err);
        }
      }
    }

    // 3) fallback to document/body computed color
    if (!rgb) {
      const cs2 = window.getComputedStyle(document.body);
      const bodyBg = cs2 && cs2.backgroundColor ? cs2.backgroundColor : '';
      rgb = parseRgbString(bodyBg);
      console.debug('applyThemeFromBackground: used body backgroundColor', bodyBg, '->', rgb);
    }

    // final fallback
    if (!rgb) rgb = [20, 14, 19];

    const palette = computeAdaptiveColors(rgb);
    const root = document.documentElement;
    root.style.setProperty('--btn-bg', palette.btnBg);
    root.style.setProperty('--btn-border', palette.btnBorder);
    root.style.setProperty('--btn-text', palette.btnText);
    root.style.setProperty('--danger-bg', palette.dangerBg);
    root.style.setProperty('--danger-border', palette.dangerBorder);
    root.style.setProperty('--danger-text', palette.dangerText);

    console.info('applyThemeFromBackground: theme applied', palette);
  } catch (err) {
    console.error('applyThemeFromBackground error', err);
  }
}

function onModelPicked(value: string) {
  selectedModelId.value = value;
  const found = cloudModels.value.find((m) => m.id === value);
  selectedModelProvider.value = (found?.provider as "openrouter" | "anthropic") || inferProviderByModel(value);
}

/** 仅最后一条为助手时允许重新输出（避免破坏中间上下文顺序） */
function canRegenerateAssistant(m: ChatMessage) {
  if (m.role !== "assistant") return false;
  const list = messages.value;
  if (!list.length || list[list.length - 1].id !== m.id) return false;
  for (let i = list.length - 2; i >= 0; i--) {
    if (list[i].role === "user" && (list[i].text || "").trim()) return true;
  }
  return false;
}

async function regenerateAssistant(assistantMessageId: string) {
  if (isBusy.value) {
    showNotice("当前有任务在执行，请稍后再试。", "warn");
    return;
  }
  const list = messages.value;
  const last = list[list.length - 1];
  if (!last || last.id !== assistantMessageId || last.role !== "assistant") {
    showNotice("只能对最后一条助手回复重新输出。", "warn");
    return;
  }
  let userPrompt = "";
  for (let i = list.length - 2; i >= 0; i--) {
    if (list[i].role === "user" && (list[i].text || "").trim()) {
      userPrompt = list[i].text.trim();
      break;
    }
  }
  if (!userPrompt) {
    showNotice("没有找到上一条用户消息，无法重新输出。", "warn");
    return;
  }
  regenerateExcludeAssistantId.value = assistantMessageId;
  currentAssistantId.value = addMessage("assistant", "", { responseState: "streaming" });
  isBusy.value = true;
  await completeChatRequest(userPrompt, { isRegenerate: true });
}

type CompleteChatOpts = { isRegenerate?: boolean };

async function completeChatRequest(userPrompt: string, opts: CompleteChatOpts = {}) {
  const isRegenerate = Boolean(opts.isRegenerate);
  const history = buildPromptHistory(14);

  const payload = {
    prompt: userPrompt,
    provider: runMode.value === "ollama" ? "ollama" : "anthropic",
    model: runMode.value === "ollama" ? (ollamaModel.value.trim() || "priestess") : (settings.ANTHROPIC_MODEL || "").trim(),
    sessionId: sessionId.value || "",
    history,
    ...(runMode.value === "ollama" ? { interactionMode: ollamaPersonaMode.value } : {}),
  };
  console.log("completeChatRequest payload:", payload);

  if (!window?.desktopApi || typeof window.desktopApi.sendMessage !== "function") {
    console.error("desktopApi.sendMessage is not available on window.desktopApi");
    showNotice("Internal error: desktop bridge not available. 检查主进程/预加载。", "warn");
    isBusy.value = false;
    messages.value = messages.value.filter((m) => m.id !== currentAssistantId.value);
    if (isRegenerate) regenerateExcludeAssistantId.value = null;
    return;
  }

  let result;
  try {
    result = await window.desktopApi.sendMessage(payload);
    if (result?.debug) {
      console.log("sendMessage debug:", result.debug);
      lastDiagnostics.value = { ...result.debug };
      if (!isRegenerate) showNotice("请求已完成，右侧可查看诊断表。", "ok");
    }
  } catch (err) {
    console.error("sendMessage invocation error", err);
    showNotice("IPC 调用失败: " + ((err as Error)?.message || String(err)), "warn");
    isBusy.value = false;
    messages.value = messages.value.filter((m) => m.id !== currentAssistantId.value);
    if (isRegenerate) regenerateExcludeAssistantId.value = null;
    return;
  }

  if (!result?.ok) {
    if (result?.debug) lastDiagnostics.value = { ...result.debug };
    if (result?.sessionId) sessionId.value = result.sessionId;
    messages.value = messages.value.filter((m) => m.id !== currentAssistantId.value);
    if (isRegenerate) {
      regenerateExcludeAssistantId.value = null;
      if (result?.stopped) showNotice("已停止重新输出。", "warn");
      else showNotice(result?.error || "重新输出失败", "warn");
    } else {
      if (result?.stopped) {
        addMessage("assistant", "任务已停止。", { responseState: "abnormal", responseReason: result?.responseReason || "stopped" });
      } else {
        addMessage("error", result?.error || "请求失败");
      }
    }
    isBusy.value = false;
    return;
  }

  const excludeId = regenerateExcludeAssistantId.value;
  const responseState = `${result?.responseState || ""}`;
  if (result?.sessionId) sessionId.value = result.sessionId;

  if (excludeId && isRegenerate && responseState !== "complete") {
    regenerateExcludeAssistantId.value = null;
    messages.value = messages.value.filter((m) => m.id !== currentAssistantId.value);
    showNotice("重新输出未以「完整」状态结束，已保留上一条助手回复。", "warn");
    isBusy.value = false;
    return;
  }

  const target = messages.value.find((m) => m.id === currentAssistantId.value);
  if (target) {
    const serverFinal = typeof result.text === "string" ? result.text.trim() : "";
    if (serverFinal) {
      target.text = serverFinal;
    } else if (!(target.text || "").trim()) {
      target.text = "[模型未返回文本]";
    }
    target.responseState = (result?.responseState || "complete") as ChatMessage["responseState"];
    target.responseReason = result?.responseReason || "";
  }

  if (excludeId && isRegenerate && responseState === "complete") {
    regenerateExcludeAssistantId.value = null;
    messages.value = messages.value.filter((m) => m.id !== excludeId);
    showNotice("重新输出已完成，上一版助手回复已移除。", "ok");
  }

  isBusy.value = false;
}

async function sendMessage() {
  if (isBusy.value) return;
  const text = inputText.value.trim();
  if (!text) return;

  addMessage("user", text);
  inputText.value = "";
  currentAssistantId.value = addMessage("assistant", "", { responseState: "streaming" });
  isBusy.value = true;
  await completeChatRequest(text, { isRegenerate: false });
}

async function stopMessage() {
  const result = await window.desktopApi.stopMessage() as any;
  if (result?.sessionId) sessionId.value = result.sessionId;
  if (!result.ok && result.error) showNotice(result.error, "warn");
}

async function chooseWorkspace() {
  const result = await window.desktopApi.chooseWorkspace();
  if (!result.ok) {
    if (result.error) showNotice(result.error, "warn");
    return;
  }
  workspacePath.value = result.path || "";
  showNotice("项目目录已切换。", "ok");
}

async function createSession() {
  if (isBusy.value) return;
  const result = await window.desktopApi.newSession();
  sessionId.value = result.sessionId;
  showNotice(`新会话已就绪（${result.sessionId.slice(0, 8)}…）`, "ok");
}

function clearMessages() {
  messages.value = [];
}

async function saveSettings() {
  if (isBusy.value) return;
  if (runMode.value === "ollama") {
    if (!ollamaModel.value.trim()) {
      showNotice("请先填写 Ollama 模型", "warn");
      return;
    }

    const localBase = ollamaBaseUrl.value.trim() || "http://127.0.0.1:11434";
    const payload: Record<string, string> = {
      MODEL_PROVIDER: "ollama",
      OLLAMA_BASE_URL: localBase,
      OLLAMA_MODEL: ollamaModel.value.trim(),
      API_TIMEOUT_MS: settings.API_TIMEOUT_MS || "3000000",
      DISABLE_TELEMETRY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ASSISTANT_AVATAR: assistantAvatar.value || "",
    };

    const saved = await window.desktopApi.saveSettings(payload);
    applySettings(saved);
    showNotice("Ollama 配置已保存。", "ok");
    return;
  }

  if (!apiKey.value.trim()) {
    showNotice("请先填写 API Key", "warn");
    return;
  }
  const cloudModel = "openrouter/auto";
  const provider: "openrouter" = "openrouter";
  const cloudBaseUrl = cloudBaseUrlByProvider(provider);
  selectedModelId.value = cloudModel;
  selectedModelProvider.value = "openrouter";

  const payload: Record<string, string> = {
    MODEL_PROVIDER: "anthropic",
    ANTHROPIC_BASE_URL: cloudBaseUrl,
    ANTHROPIC_API_KEY: apiKey.value.trim(),
    ANTHROPIC_AUTH_TOKEN: apiKey.value.trim(),
    ANTHROPIC_MODEL: cloudModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: "",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "",
    API_TIMEOUT_MS: settings.API_TIMEOUT_MS || "3000000",
    DISABLE_TELEMETRY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ASSISTANT_AVATAR: assistantAvatar.value || "",
  };

  const saved = await window.desktopApi.saveSettings(payload);
  applySettings(saved);
  showNotice("已保存。云端模型已固定为 openrouter/auto。", "ok");
}

async function clearModelFields() {
  if (isBusy.value) return;
  const saved = await window.desktopApi.clearModelSettings();
  applySettings(saved);
  selectedModelId.value = "";
  selectedModelProvider.value = "";
  showNotice("模型字段已清空。", "warn");
}

async function loadCloudModels(source: "openrouter" | "anthropic") {
  loadingModels.value = true;
  try {
    const result = await window.desktopApi.listModels({ source, apiKey: apiKey.value });
    if (!result.ok) {
      showNotice(result.error || "模型列表加载失败", "warn");
      return;
    }
    cloudModels.value = result.models || [];
    showNotice(`已加载 ${cloudModels.value.length} 个${source === "openrouter" ? " OpenRouter" : " Anthropic"}模型`, "ok");
  } finally {
    loadingModels.value = false;
  }
}

function toggleHero() {
  const wasCollapsed = heroCollapsed.value;
  heroCollapsed.value = !wasCollapsed;
  heroAnimating.value = wasCollapsed ? 'expand' : 'shrink';
  // small pulse when expanding
  if (wasCollapsed) {
    heroPulse.value = true;
    setTimeout(() => (heroPulse.value = false), 420);
  }
  // clear anim flag after animation
  setTimeout(() => (heroAnimating.value = ''), 420);
}

function toggleSettings() {
  const wasCollapsed = settingsCollapsed.value;
  settingsCollapsed.value = !wasCollapsed;
  settingsAnimating.value = wasCollapsed ? 'expand' : 'shrink';
  setTimeout(() => (settingsAnimating.value = ''), 360);
}

watch([glassBannerOpacity, glassChatOpacity, glassSidebarOpacity], () => {
  try {
    localStorage.setItem(GLASS_KEYS.banner, String(glassBannerOpacity.value));
    localStorage.setItem(GLASS_KEYS.chat, String(glassChatOpacity.value));
    localStorage.setItem(GLASS_KEYS.sidebar, String(glassSidebarOpacity.value));
  } catch {
    /* ignore */
  }
});

let skipNextOllamaPersonaWatch = false;
watch(ollamaPersonaMode, async (next, prev) => {
  if (skipNextOllamaPersonaWatch) {
    skipNextOllamaPersonaWatch = false;
    return;
  }
  if (runMode.value !== "ollama") return;
  if (prev === undefined) return;
  if (next === prev) return;
  if (isBusy.value) {
    showNotice("当前有任务在执行，请结束后再切换人格/助手模式。", "warn");
    skipNextOllamaPersonaWatch = true;
    ollamaPersonaMode.value = prev;
    return;
  }
  try {
    const result = await window.desktopApi.newSession();
    sessionId.value = result.sessionId;
    messages.value = [];
    addMessage("assistant", next === "assistant" ? CLI_MODE_WELCOME : DEFAULT_ASSISTANT_WELCOME);
    showNotice(
      next === "assistant"
        ? "已切换为助手模式：新建会话并清空聊天，避免普瑞赛斯人格上下文进入 CLI。"
        : "已切换为普瑞赛斯模式：新建会话并清空聊天。",
      "ok",
    );
  } catch (e) {
    skipNextOllamaPersonaWatch = true;
    ollamaPersonaMode.value = prev;
    showNotice("切换模式失败：" + ((e as Error)?.message || String(e)), "warn");
  }
});

onMounted(async () => {
  glassBannerOpacity.value = readStoredGlass(GLASS_KEYS.banner, 52);
  glassChatOpacity.value = readStoredGlass(GLASS_KEYS.chat, 42);
  glassSidebarOpacity.value = readStoredGlass(GLASS_KEYS.sidebar, 58);

  const appState = await window.desktopApi.getState();
  sessionId.value = appState.sessionId || "";
  workspacePath.value = appState.workspacePath || "";
  isBusy.value = Boolean(appState.busy);
  applySettings(appState.settings || {});

  addMessage("assistant", DEFAULT_ASSISTANT_WELCOME);

  // Ensure assistant and user avatars have sensible defaults (project assets) if not configured
  if (!assistantAvatar.value) {
    assistantAvatar.value = avatarRC;
  }
  if (!userAvatar.value) {
    userAvatar.value = avatarUser;
  }

  // SPECIAL ALGORITHM MODULE: adaptive theme
  // Apply adaptive theme based on computed background color (reads computed background and sets CSS variables)
  // See functions: applyThemeFromBackground(), computeAdaptiveColors(), color helpers below.
  try { applyThemeFromBackground(); } catch (e) { console.warn('applyThemeFromBackground failed', e); }

  window.desktopApi.onDelta((payload) => {
    if (!payload?.text) return;
    const target = messages.value.find((m) => m.id === currentAssistantId.value);
    if (target) {
      target.text += payload.text;
      if (target.role === "assistant") target.responseState = "streaming";
    }
  });

  window.desktopApi.onStatus((payload) => {
    if (payload && typeof payload.busy === "boolean") {
      isBusy.value = payload.busy;
    }
  });

  // launch animation: show UI after 1s, finish launch at 3s
  setTimeout(() => { launchUIVisible.value = true; }, 1000);
  setTimeout(() => { heroLaunching.value = false; }, 3000);
});

watch(
  messages,
  () => {
    if (!messages.value.length) return;
    scrollMessagesToEnd();
  },
  { deep: true },
);
</script>

<template>
  <div class="page" :style="pageGlassStyle">
    <div v-if="heroLaunching" class="launch-overlay" aria-hidden>
      <div class="launch-title">普瑞赛斯</div>
    </div>
    <header v-show="launchUIVisible || !heroLaunching" :class="['hero', { launching: heroLaunching, collapsed: heroCollapsed }]">
      <h1 :class="['brand-title', { pulse: heroPulse }]">普瑞赛斯</h1>
      <p class="hero-desc">只需配置 API Key 与模型，随后直接在项目里发起编码任务。</p>

      <button class="hero-toggle" @click="toggleHero" :title="heroCollapsed ? '展开横幅' : '收起横幅'" aria-label="toggle hero">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 15l7-7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </header>


    <transition name="app-fade" appear>
      <main v-show="launchUIVisible || !heroLaunching" class="workbench" :class="{ single: !showSettings, 'settings-collapsed': settingsCollapsed }"> 
      <button v-if="showSettings" class="settings-toggle" @click="toggleSettings" :aria-expanded="!settingsCollapsed" :title="settingsCollapsed ? '展开快速配置' : '收起快速配置'">
        <svg class="collapse-icon" :class="{ collapsed: settingsCollapsed }" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M8 5l8 7-8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <section class="chat card">
        <div class="toolbar ios-bar">
          <div class="session ios-session-pill">会话：{{ sessionId || "未创建" }}</div>
          <div class="actions">
            <button type="button" class="ios-btn-secondary" @click="createSession" :disabled="isBusy">新会话</button>
            <button type="button" class="danger ios-btn-danger" @click="stopMessage" :disabled="!isBusy">停止</button>
          </div>
        </div>

        <div ref="messagesEl" class="messages" aria-label="对话消息">
          <article v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <img v-if="(m.role === 'assistant' && assistantAvatar) || (m.role === 'user' && userAvatar)" :src="m.role === 'assistant' ? assistantAvatar : userAvatar" class="avatar" :alt="m.role === 'assistant' ? 'PRTS avatar' : '用户头像'" />

            <div class="bubble">
              <label class="bubble-label-row">
                <span class="bubble-label-text">
                  {{ m.role === 'assistant' ? 'PRTS' : roleLabel(m.role) }}
                  <span v-if="m.role === 'assistant'" class="resp-state" :class="m.responseState || 'complete'">
                    {{ responseStateLabel(m) }}
                  </span>
                </span>
                <button
                  v-if="m.role === 'assistant' && canRegenerateAssistant(m)"
                  type="button"
                  class="regen-btn"
                  :disabled="isBusy"
                  title="重新输出（完成后移除上一版助手回复）"
                  aria-label="重新输出"
                  @click.stop="regenerateAssistant(m.id)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path
                      d="M4.5 9.5A7.5 7.5 0 0114.94 5M19.5 14.5A7.5 7.5 0 019.06 19M5 5v4h4M19 19v-4h-4"
                      stroke="currentColor"
                      stroke-width="1.85"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </label>

              <template v-if="m.role === 'assistant' && m.id === currentAssistantId && isBusy && !(m.text || '').trim()">
                <div class="thinking">
                  <span class="dot" aria-hidden></span>
                  <span class="dot" aria-hidden></span>
                  <span class="dot" aria-hidden></span>
                </div>
              </template>

              <template v-else>
                <div
                  v-if="m.role === 'assistant'"
                  class="bubble-md"
                  v-html="renderAssistantMarkdown(m.text)"
                />
                <pre v-else>{{ m.text }}</pre>
              </template>
            </div>
          </article>
        </div>

        <div class="composer ios-composer">
          <div class="ios-composer-field">
            <textarea
              v-model="inputText"
              class="composer-textarea"
              rows="3"
              :disabled="isBusy"
              placeholder="输入编码任务（Enter 发送，Shift+Enter 换行）"
              spellcheck="false"
              autocomplete="off"
              @keydown.enter.exact.prevent="sendMessage"
            ></textarea>
          </div>
          <div class="composer-foot">
            <span class="composer-status">{{ isBusy ? "执行中…" : "就绪" }}</span>
            <div class="composer-actions">
              <button type="button" class="ios-btn-secondary" @click="clearMessages" :disabled="isBusy">清空</button>
              <button type="button" class="primary ios-btn-primary" @click="sendMessage" :disabled="isBusy">发送任务</button>
            </div>
          </div>
        </div>
      </section>

      <aside v-if="showSettings" :class="['settings card', { collapsed: settingsCollapsed, 'animating-expand': settingsAnimating === 'expand', 'animating-shrink': settingsAnimating === 'shrink' }]">
        <div class="settings-header">
          <h2>快速配置</h2>
        </div>

        <transition name="settings-fade" appear>
          <div v-if="!settingsCollapsed" class="settings-body-scaffold">
            <div class="settings-scroll">
              <section class="ios-form-group" aria-label="运行模式">
                <div class="ios-group-label">运行模式</div>
                <div class="ios-segment" role="tablist" aria-label="云端或本地">
                  <button
                    type="button"
                    role="tab"
                    class="ios-segment-btn"
                    :class="{ active: runMode === 'cloud' }"
                    :aria-selected="runMode === 'cloud'"
                    @click="runMode = 'cloud'"
                  >
                    云端
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="ios-segment-btn"
                    :class="{ active: runMode === 'ollama' }"
                    :aria-selected="runMode === 'ollama'"
                    @click="runMode = 'ollama'"
                  >
                    本地 Ollama
                  </button>
                </div>
                <transition name="ios-foot-fade" mode="out-in">
                  <p class="ios-segment-foot ios-segment-foot-animated" :key="runMode">
                    {{ runMode === "cloud" ? "OpenRouter / Anthropic API" : "本机模型与普瑞赛斯人格" }}
                  </p>
                </transition>
              </section>

              <transition name="runmode-panel" mode="out-in">
                <div v-if="runMode === 'cloud'" key="cloud" class="runmode-stack">
                  <section class="ios-form-group" aria-label="云端凭据">
                    <label class="field ios-group-field">
                      <span>API Key</span>
                      <input v-model="apiKey" type="password" placeholder="输入你的 API Key" />
                    </label>
                    <label class="field ios-group-field">
                      <span>云端模型（固定）</span>
                      <input value="openrouter/auto" readonly />
                    </label>
                  </section>
                </div>
                <div v-else key="ollama" class="runmode-stack">
                  <section class="ios-form-group ios-form-group-plain" aria-label="人格">
                    <div class="field ios-field">
                      <div class="ios-switch-row">
                        <div class="ios-switch-text">
                          <span class="ios-switch-title">普瑞赛斯人格</span>
                          <span class="ios-switch-sub">{{ ollamaPersonaMode === "priestess" ? "已开启 · 仅对话" : "已关闭 · 助手 CLI" }}</span>
                        </div>
                        <button
                          type="button"
                          class="ios-switch"
                          :class="{ on: ollamaPersonaMode === 'priestess' }"
                          role="switch"
                          :aria-checked="ollamaPersonaMode === 'priestess'"
                          :aria-label="ollamaPersonaMode === 'priestess' ? '关闭普瑞赛斯人格' : '开启普瑞赛斯人格'"
                          @click="toggleOllamaPersonaSwitch"
                        >
                          <span class="ios-switch-knob" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </section>
                  <p class="field-hint ios-footnote" v-if="ollamaPersonaMode === 'priestess'">
                    开启时不注入项目文件与目录树；需要读代码时请关闭开关进入助手模式。
                  </p>
                  <p class="field-hint ios-footnote" v-else>
                    助手模式走 Claude Code CLI，无锁人格，可使用工具链读写工程。
                  </p>
                  <section class="ios-form-group" aria-label="Ollama">
                    <label class="field ios-group-field">
                      <span>Ollama 地址</span>
                      <input v-model="ollamaBaseUrl" placeholder="http://127.0.0.1:11434" />
                    </label>
                    <label class="field ios-group-field">
                      <span>Ollama 模型</span>
                      <input v-model="ollamaModel" placeholder="例如 qwen3:4b" />
                    </label>
                  </section>
                </div>
              </transition>

              <section class="ios-form-group" aria-label="项目目录">
                <label class="field ios-group-field">
                  <span>当前项目</span>
                  <div class="path-search">
                    <button class="path-drive-btn" @click="openDriveBtn" title="打开所在磁盘">
                      <span class="path-icon" aria-hidden>🔎</span>
                      <strong class="drive-letter">{{ displayDrive(workspacePath) }}</strong>
                    </button>
                    <div class="path-display" @click="togglePathDisplay" :title="pathExpanded ? '点击显示省略路径' : '点击显示完整路径'"><span class="path-inner">{{ pathExpanded ? workspacePath : displayPath(workspacePath) }}</span></div>
                    <button class="path-btn" @click="chooseWorkspace">打开项目</button>
                  </div>
                </label>
              </section>

              <div class="setting-actions ios-actions-row">
                <button type="button" class="ios-btn-secondary" @click="clearModelFields" :disabled="isBusy">清空模型</button>
                <button type="button" class="primary ios-btn-primary" @click="saveSettings" :disabled="isBusy">保存并启用</button>
              </div>

              <section class="ios-form-group ios-glass-settings" aria-label="界面毛玻璃">
                <div class="ios-group-label">界面毛玻璃</div>
                <p class="ios-glass-hint">
                  调低：叠色与雾化减弱，背后背景更清晰。调高：略加深色叠色并增强模糊（偏磨砂，不偏白）。
                </p>
                <div class="ios-slider-block ios-glass-slider-pad">
                  <div class="ios-slider-row">
                    <span class="ios-slider-label">横幅</span>
                    <span class="ios-slider-value" aria-hidden>{{ glassBannerOpacity }}%</span>
                  </div>
                  <input
                    v-model.number="glassBannerOpacity"
                    class="ios-slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="横幅毛玻璃强度"
                  />
                </div>
                <div class="ios-slider-block ios-glass-slider-pad">
                  <div class="ios-slider-row">
                    <span class="ios-slider-label">对话区</span>
                    <span class="ios-slider-value" aria-hidden>{{ glassChatOpacity }}%</span>
                  </div>
                  <input
                    v-model.number="glassChatOpacity"
                    class="ios-slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="对话区毛玻璃强度"
                  />
                </div>
                <div class="ios-slider-block ios-glass-slider-pad">
                  <div class="ios-slider-row">
                    <span class="ios-slider-label">侧栏</span>
                    <span class="ios-slider-value" aria-hidden>{{ glassSidebarOpacity }}%</span>
                  </div>
                  <input
                    v-model.number="glassSidebarOpacity"
                    class="ios-slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="快速配置侧栏毛玻璃强度"
                  />
                </div>
              </section>

              <div v-if="lastDiagnostics" class="diag-panel ios-inset-panel">
                <div class="diag-panel-title">上次请求 · 解析诊断</div>
                <table class="diag-table">
                  <tbody>
                    <tr>
                      <th scope="row">链路</th>
                      <td>{{ lastDiagnostics.bridgeMode || "—" }}</td>
                    </tr>
                    <tr>
                      <th scope="row">Ollama 模式</th>
                      <td>{{ lastDiagnostics.ollamaInteraction === "assistant" ? "助手" : lastDiagnostics.ollamaInteraction === "priestess" ? "普瑞赛斯" : "—" }}</td>
                    </tr>
                    <tr>
                      <th scope="row">上下文长度</th>
                      <td>{{ lastDiagnostics.length ?? 0 }} 字符</td>
                    </tr>
                    <tr>
                      <th scope="row">工作区上下文</th>
                      <td>{{ lastDiagnostics.hasWorkspaceContext ? "已注入" : "未注入" }}</td>
                    </tr>
                    <tr>
                      <th scope="row">目标文件</th>
                      <td>{{ lastDiagnostics.targetFileSummary || (lastDiagnostics.hasTargetFileContext ? "已纳入上下文" : "未纳入") }}</td>
                    </tr>
                    <tr>
                      <th scope="row">会话历史</th>
                      <td>{{ lastDiagnostics.hasConversationHistory ? "已携带" : "未携带" }}</td>
                    </tr>
                    <tr>
                      <th scope="row">Modelfile</th>
                      <td>{{ lastDiagnostics.hasModelfileRef ? "已出现在上下文中" : "未出现" }}</td>
                    </tr>
                    <tr>
                      <th scope="row">CLI 工作目录</th>
                      <td class="diag-mono">{{ lastDiagnostics.cliCwd || "—" }}</td>
                    </tr>
                    <tr>
                      <th scope="row">CLI 退出码</th>
                      <td>{{ lastDiagnostics.cliExitCode === null || lastDiagnostics.cliExitCode === undefined ? "—" : lastDiagnostics.cliExitCode }}</td>
                    </tr>
                    <tr>
                      <th scope="row">CLI stderr</th>
                      <td class="diag-pre-wrap">{{ lastDiagnostics.cliStderrPreview || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p class="notice" :class="noticeType">{{ noticeText }}</p>
            </div>
          </div>
        </transition>
      </aside>
      </main>
    </transition>
  </div>
</template>

<style scoped>
.page {
  --ios-r-card: 22px;
  --ios-r-group: 14px;
  --ios-r-bubble: 18px;
  --ios-r-pill: 999px;
  --ios-blur: 20px;
  --ios-glass: rgba(22, 16, 28, 0.58);
  --ios-glass-chat: rgba(16, 11, 20, 0.42);
  --ios-glass-strong: rgba(18, 12, 22, 0.82);
  --ios-hairline: rgba(255, 255, 255, 0.085);
  --ios-fill: rgba(255, 245, 252, 0.055);
  --ios-fill-pressed: rgba(255, 245, 252, 0.1);
  --ios-card-shadow: 0 14px 48px rgba(0, 0, 0, 0.32), 0 1px 0 rgba(255, 255, 255, 0.05) inset;
  --ios-focus: rgba(90, 200, 250, 0.45);
  /* 由滑杆写入：strength 0–1，blur 为 px */
  --glass-banner-strength: 0.52;
  --glass-banner-blur: 15px;
  --glass-chat-strength: 0.42;
  --glass-chat-blur: 10px;
  --glass-sidebar-strength: 0.58;
  --glass-sidebar-blur: 14px;
  height: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: url('./assets/background.png') no-repeat center center / cover;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.hero {
  border-radius: var(--ios-r-card);
  border: 1px solid rgba(12, 141, 240, 0.55);
  box-shadow: var(--ios-card-shadow);
  backdrop-filter: saturate(calc(100% + 55% * var(--glass-banner-strength))) blur(var(--glass-banner-blur));
  background:
    radial-gradient(80% 120% at 0% 100%, rgba(153, 102, 203, calc(0.22 * var(--glass-banner-strength))), transparent 42%),
    radial-gradient(56% 110% at 88% 0%, rgba(112, 42, 24, calc(0.15 * var(--glass-banner-strength))), transparent 58%),
    linear-gradient(165deg, rgba(24, 14, 18, calc(0.52 * var(--glass-banner-strength))), rgba(14, 10, 16, calc(0.48 * var(--glass-banner-strength))));
  padding: 24px;
  position: relative;
  overflow: hidden;
  transition: height 360ms cubic-bezier(.2,.9,.2,1), padding 360ms cubic-bezier(.2,.9,.2,1), transform 320ms ease;
}

/* launch animation: scale up title then shrink into place */
.hero.launching .brand-title {
  animation: brand-launch 900ms cubic-bezier(.2,.9,.2,1) both;
}

@keyframes brand-launch {
  0% { transform: translateY(-10vh) scale(3.2); opacity: 1; }
  40% { transform: translateY(2vh) scale(1.05); }
  100% { transform: translateY(0) scale(1); }
}

/* collapsed hero: shrink upward */
.hero.collapsed { height: 56px; padding: 8px 12px; }
.hero .brand-title { transition: transform 320ms cubic-bezier(.2,.9,.2,1), font-size 320ms ease; transform-origin: left top; }
.hero.collapsed .brand-title { transform: scale(0.86) translateY(-1px); font-size: 20px; }
.hero.collapsed .hero-desc, .hero.collapsed .path-chip { display: none; }

.badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #8614c3d4;
  border: 1px solid rgba(33, 198, 101, 0.35);
  background: rgba(9, 164, 211, 0.35);
}

.hero h1 {
  margin: 12px 0 8px;
  font-size: clamp(36px, 4.2vw, 58px);
  line-height: 1.08;
  color: #fff7ef;
}

.hero p {
  margin: 0;
  color: #cbb8aa;
  line-height: 1.6;
}

.path-chip {
  margin-top: 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 167, 112, 0.22);
  background: rgba(26, 18, 22, 0.42);
  backdrop-filter: blur(12px);
  color: #d8c1b2;
  font-size: 12px;
  padding: 9px 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* inline small display used previously in toolbar, keep compact */
.path-chip-inline {
  background: rgba(18,12,17,0.6);
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #e6d7c8;
}

.flowbar {
  border-radius: 12px;
  border: 1px solid rgba(255, 165, 106, 0.18);
  background: rgba(24, 17, 23, 0.3);
  color: #60627a;
  font-size: 13px;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.workbench {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  position: relative;
}

.workbench.single {
  grid-template-columns: 1fr;
}

.card {
  border-radius: var(--ios-r-card);
  border: 1px solid rgba(145, 102, 147, 0.22);
  background: var(--ios-glass);
  backdrop-filter: saturate(150%) blur(var(--ios-blur));
  box-shadow: var(--ios-card-shadow);
  min-height: 0;
}

.chat {
  display: flex;
  flex-direction: column;
  padding: 14px;
  gap: 12px;
  background: rgba(16, 11, 20, calc(0.5 * var(--glass-chat-strength)));
  backdrop-filter: saturate(calc(100% + 50% * var(--glass-chat-strength))) blur(var(--glass-chat-blur));
}

aside.settings.card {
  background: rgba(22, 16, 28, calc(0.58 * var(--glass-sidebar-strength)));
  backdrop-filter: saturate(calc(100% + 60% * var(--glass-sidebar-strength))) blur(var(--glass-sidebar-blur));
}

.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.toolbar.ios-bar {
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--ios-hairline);
}

.session {
  color: #8a9aad;
  font-size: 12px;
}

.ios-session-pill {
  padding: 5px 11px;
  border-radius: var(--ios-r-pill);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--ios-hairline);
  color: #c5d0e0;
  max-width: 56%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.msg {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin: 6px 0;
}

.msg.assistant { justify-content: flex-start; flex-direction: row; }
.msg.user { justify-content: flex-start; flex-direction: row-reverse; }

.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.avatar-spacer { width: 48px; height: 48px; }

.bubble {
  max-width: 78%;
  min-width: 0;
  padding: 11px 15px 12px;
  border-radius: var(--ios-r-bubble);
  background: linear-gradient(165deg, rgba(168, 98, 178, 0.42), rgba(120, 58, 132, 0.38));
  border: 1px solid rgba(255, 200, 220, 0.14);
  color: #f4e6dc;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.22), 0 1px 0 rgba(255, 255, 255, 0.06) inset;
  backdrop-filter: blur(10px);
}

.msg.user .bubble {
  background: linear-gradient(165deg, rgba(56, 58, 128, 0.62), rgba(36, 38, 98, 0.55));
  margin-right: 6px;
  border-color: rgba(160, 175, 255, 0.18);
}

.bubble-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #d2b4a2;
}

.bubble-label-text {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.regen-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.22);
  color: #e8c8ff;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.15s ease;
}

.regen-btn:hover:not(:disabled) {
  background: rgba(120, 90, 160, 0.45);
  border-color: rgba(200, 170, 255, 0.35);
  color: #fff;
  transform: rotate(-18deg);
}

.regen-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.bubble .regen-btn {
  font-size: 0;
  box-shadow: none;
}

.resp-state {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.4;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #f4e6dc;
}

.resp-state.streaming {
  background: rgba(94, 129, 172, 0.32);
}

.resp-state.complete {
  background: rgba(96, 168, 106, 0.26);
}

.resp-state.abnormal {
  background: rgba(191, 97, 106, 0.34);
}

.bubble pre {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.6;
  color: #f4e6dc;
  font-family: inherit;
  max-height: min(65vh, 520px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

.bubble-md {
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
  max-height: min(65vh, 520px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.bubble-md :deep(p) {
  margin: 0 0 0.55em;
}

.bubble-md :deep(p:last-child) {
  margin-bottom: 0;
}

.bubble-md :deep(ul),
.bubble-md :deep(ol) {
  margin: 0.35em 0 0.55em;
  padding-left: 1.35em;
}

.bubble-md :deep(li) {
  margin: 0.2em 0;
}

.bubble-md :deep(h1),
.bubble-md :deep(h2),
.bubble-md :deep(h3) {
  margin: 0.5em 0 0.35em;
  font-size: 1.05em;
  font-weight: 600;
  color: #fff4ea;
}

.bubble-md :deep(a) {
  color: #ffb86c;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.bubble-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.28);
}

.bubble-md :deep(pre) {
  margin: 0.5em 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow-x: auto;
  white-space: pre;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
}

.bubble-md :deep(pre code) {
  padding: 0;
  background: transparent;
}

.bubble-md :deep(blockquote) {
  margin: 0.45em 0;
  padding: 0.25em 0 0.25em 0.75em;
  border-left: 3px solid rgba(255, 184, 108, 0.55);
  color: #e8d8cc;
}

.bubble-md :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 12px;
}

.bubble-md :deep(th),
.bubble-md :deep(td) {
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 4px 8px;
}

.bubble-md :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  margin: 0.65em 0;
}

.md-fallback {
  margin: 0;
  white-space: pre-wrap;
}

.bubble-tool-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #e8c4a0;
}

.ios-field {
  margin-bottom: 0;
}

.ios-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ios-switch-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ios-switch-title {
  font-size: 14px;
  font-weight: 600;
  color: #f4e6dc;
}

.ios-switch-sub {
  font-size: 12px;
  color: #b9a090;
}

.ios-switch {
  flex-shrink: 0;
  width: 51px;
  height: 31px;
  border-radius: 999px;
  border: none;
  padding: 0;
  cursor: pointer;
  position: relative;
  background: rgba(80, 80, 90, 0.85);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  transition: background 0.22s ease;
}

.ios-switch.on {
  background: #34c759;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.ios-switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 25px;
  height: 25px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.ios-switch.on .ios-switch-knob {
  transform: translateX(20px);
}

.diag-panel {
  margin-top: 4px;
  padding: 12px 12px 10px;
}

.diag-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: #e8d4c4;
  margin-bottom: 8px;
}

.diag-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  color: #e8d8cc;
}

.diag-table th {
  width: 38%;
  text-align: left;
  font-weight: 500;
  color: #c8b0a2;
  padding: 5px 8px 5px 0;
  vertical-align: top;
  border: none;
}

.diag-table td {
  padding: 5px 0;
  vertical-align: top;
  border: none;
  word-break: break-word;
}

.diag-pre-wrap {
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  max-height: 220px;
  overflow-y: auto;
  color: #dccfbf;
}

.diag-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  word-break: break-all;
  color: #dccfbf;
}

.diag-table tr + tr th,
.diag-table tr + tr td {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.ios-form-group {
  margin-bottom: 14px;
  border-radius: var(--ios-r-group);
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid var(--ios-hairline);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.ios-form-group-plain {
  background: rgba(0, 0, 0, 0.18);
}

.ios-group-label {
  display: block;
  padding: 11px 14px 4px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #e8d4cf;
}

.ios-segment {
  display: flex;
  margin: 6px 10px 0;
  padding: 3px;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
  gap: 2px;
}

.ios-segment-btn {
  flex: 1;
  margin: 0;
  padding: 7px 10px;
  border: none;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(244, 230, 220, 0.72);
  background: transparent;
  box-shadow: none;
  transition:
    background 0.28s cubic-bezier(0.25, 0.1, 0.25, 1),
    color 0.28s cubic-bezier(0.25, 0.1, 0.25, 1),
    box-shadow 0.28s cubic-bezier(0.25, 0.1, 0.25, 1),
    transform 0.15s ease;
}

.ios-segment-btn:hover {
  color: #fff7ef;
}

.ios-segment-btn.active {
  color: #2a130c;
  background: linear-gradient(180deg, rgba(255, 200, 160, 0.95), rgba(233, 143, 71, 0.92));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
}

.ios-segment-foot {
  margin: 6px 14px 12px;
  font-size: 11px;
  line-height: 1.45;
  color: #a8988c;
}

.ios-segment-foot-animated {
  display: block;
}

.ios-form-group .ios-group-field {
  margin: 0;
  padding: 11px 14px;
  gap: 8px;
  border-top: 1px solid var(--ios-hairline);
}

.ios-form-group .ios-group-field:first-of-type {
  border-top: none;
}

.ios-form-group .ios-switch-row {
  padding: 12px 14px 14px;
  border-bottom: none;
}

.ios-footnote {
  margin: -6px 0 12px;
  padding: 0 4px;
}

.ios-actions-row {
  margin-top: 4px;
  gap: 10px;
}

.ios-inset-panel {
  border-radius: var(--ios-r-group);
  background: rgba(0, 0, 0, 0.26);
  border: 1px solid var(--ios-hairline);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ios-composer-field {
  border-radius: 16px;
  border: 1px solid rgba(255, 200, 220, 0.12);
  background: linear-gradient(165deg, rgba(32, 22, 40, 0.72), rgba(14, 10, 20, 0.55));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.06) inset,
    0 4px 20px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  transition: box-shadow 0.22s ease, border-color 0.22s ease, background 0.22s ease;
}

.ios-composer-field:focus-within {
  border-color: rgba(120, 190, 255, 0.42);
  background: linear-gradient(165deg, rgba(38, 28, 52, 0.82), rgba(16, 12, 24, 0.62));
  box-shadow:
    0 0 0 3px var(--ios-focus),
    0 1px 0 rgba(255, 255, 255, 0.07) inset,
    0 6px 24px rgba(0, 0, 0, 0.28);
}

.composer .composer-textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 92px;
  max-height: 220px;
  resize: vertical;
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 14px 16px 16px;
  font-size: 15px;
  line-height: 1.5;
  letter-spacing: 0.01em;
  color: #f8eee4;
  caret-color: rgba(140, 200, 255, 0.95);
}

.composer .composer-textarea::placeholder {
  color: rgba(216, 196, 180, 0.42);
  font-size: 14px;
}

.composer .composer-textarea:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.composer .composer-textarea:focus {
  outline: none;
}

.composer .composer-textarea::selection {
  background: rgba(120, 170, 255, 0.35);
}

.composer-status {
  font-variant-numeric: tabular-nums;
  color: #b9a9a0;
}

.composer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.composer-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #c8b0a2;
}

.composer-foot > div {
  display: flex;
  gap: 8px;
}

.settings {
  position: relative;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  min-height: 0;
  max-height: 100%;
  width: 360px;
  align-self: stretch;
  transition: width 320ms cubic-bezier(.2,.9,.2,1), transform 320ms ease, opacity 260ms ease;
}

.settings.collapsed {
  width: 48px;
  padding: 6px;
  align-items: center;
}

.settings-header {
  height: 48px;
  display:flex;
  align-items:center;
  justify-content:center;
  position: relative;
}

.settings-header h2 { margin: 0; transition: transform 320ms ease; }

.settings.collapsed .settings-header h2 {
  transform: rotate(-90deg);
  transform-origin: left center;
  position: absolute;
  left: 10px;
  top: 50%;
}

.settings-body {
  overflow: hidden;
  transition: opacity 260ms ease, transform 260ms ease, max-height 260ms ease;
  opacity: 1;
  transform: translateX(0);
  max-height: 2000px;
}

.settings-body.hidden {
  opacity: 0;
  transform: translateX(-8px);
  pointer-events: none;
  max-height: 0;
  height: 0;
}

.settings.collapsed .settings-header h2 { display: none; }

.collapse-btn {
  border: 1px solid rgba(255,164,104,0.2);
  background: rgba(18,12,17,0.82);
  color: #f4e7de;
  padding: 6px 8px;
  border-radius: 8px;
  transition: transform 220ms ease, background 220ms ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.collapse-btn:hover { transform: scale(1.03); }

.collapse-icon {
  transition: transform 260ms cubic-bezier(.2,.9,.2,1);
  color: #f4e7de;
}

.collapse-icon.collapsed {
  transform: rotate(180deg);
}

/* temporary peek state when hovering collapsed column */
.settings.peek { width: 360px !important; }

/* transition for settings inner appear/leave */
.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 260ms ease, transform 260ms ease;
}

.settings-body-scaffold {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 2px 10px 0;
  -webkit-overflow-scrolling: touch;
}

.settings-scroll::-webkit-scrollbar {
  width: 6px;
}

.settings-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.settings-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.ios-glass-settings {
  margin-top: 4px;
}

.ios-glass-hint {
  margin: -2px 14px 10px;
  font-size: 11px;
  line-height: 1.45;
  color: #9e8f86;
}

.ios-glass-slider-pad {
  padding: 0 12px;
}

.ios-glass-slider-pad:last-of-type {
  padding-bottom: 14px;
}

.ios-slider-block + .ios-slider-block {
  margin-top: 10px;
}

.ios-slider-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}

.ios-slider-label {
  font-size: 13px;
  font-weight: 600;
  color: #e8d4cf;
}

.ios-slider-value {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #8ec5ff;
  min-width: 38px;
  text-align: right;
}

.runmode-stack {
  width: 100%;
}

.runmode-panel-enter-active,
.runmode-panel-leave-active {
  transition: opacity 0.26s cubic-bezier(0.25, 0.1, 0.25, 1), transform 0.26s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.runmode-panel-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.runmode-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.ios-foot-fade-enter-active,
.ios-foot-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.ios-foot-fade-enter-from,
.ios-foot-fade-leave-to {
  opacity: 0;
  transform: translateY(3px);
}

/* app fade for full UI after launch */
.app-fade-enter-from,
.app-fade-leave-to { opacity: 0; transform: translateY(6px); }
.app-fade-enter-active,
.app-fade-leave-active { transition: opacity 420ms ease, transform 420ms ease; }

/* settings toggle button positioned fixed relative to workbench so it won't jump */
.settings-toggle {
  position: absolute;
  right: calc(12px + -1.5mm);
  top: calc(16px - 2mm);
  width: 36px;
  height: 36px;
  border-radius: 11px;
  border: 1px solid rgba(255,164,104,0.14);
  background: rgba(18,12,17,0.88);
  backdrop-filter: blur(14px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  cursor: pointer;
  transition: transform 200ms ease, background 200ms ease;
}

.settings-toggle:hover { transform: scale(1.04); }

/* Keep the collapse icon centered and only rotate it on toggle */
.settings-toggle .collapse-icon { transition: transform 260ms cubic-bezier(.2,.9,.2,1); }
.settings-toggle .collapse-icon.collapsed { transform: rotate(180deg); }


.collapse-btn.vertical {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  padding: 8px 6px;
}

/* When collapsed, the chat area expands implicitly because settings width shrinks */
@media (max-width: 1024px) {
  .settings { width: 320px; }
  .settings.collapsed { width: 48px; }
  .settings.peek { width: 320px; }
}

.settings h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fdebe0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-hint {
  margin: -2px 0 4px;
  font-size: 11px;
  line-height: 1.45;
  color: #a8988c;
}

/* path-search: looks like a search input with icon, path text and action button */
.path-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-radius: 11px;
  background: rgba(8, 6, 12, 0.45);
  border: 1px solid rgba(255, 162, 97, 0.12);
}

.path-icon {
  font-size: 16px;
  color: #e7c7b0;
  flex: 0 0 auto;
}

.path-drive-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 9px;
  background: var(--btn-bg, rgba(18,12,17,0.95));
  border: 1px solid var(--btn-border, rgba(255,165,106,0.12));
  color: var(--btn-text, #e7c7b0);
  cursor: pointer;
  flex: 0 0 auto;
}

.path-drive-btn:hover { transform: translateY(-1px); }

.drive-letter {
  font-weight: 800;
  color: var(--btn-text, #fdebe0);
}

.path-display {
  font-size: 13px;
  color: #d8c1b2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  cursor: pointer;
  /* show tail (ellipsis at start) */
  direction: rtl;
  text-align: left;
}

.path-display .path-inner {
  display: inline-block;
  direction: ltr;
  /* ensure the inner content doesn't collapse */
  min-width: 0;
}
.path-btn {
  flex: 0 0 auto;
  padding: 7px 12px;
  border-radius: 9px;
  background: var(--btn-bg, rgba(18,12,17,0.95));
  color: var(--btn-text, #f4e7de);
  border: 1px solid var(--btn-border, rgba(255,165,106,0.9));
  font-weight: 700;
  box-shadow: 0 1px 0 rgba(0,0,0,0.25) inset;
}

.field span {
  font-size: 12px;
  color: #cfb8aa;
}

.setting-actions,
.model-loader {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.notice {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.45;
  min-height: 16px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid transparent;
}

.notice.ok {
  color: #f2c9a4;
}

.notice.warn {
  color: #d81010;
}

input,
textarea,
button,
select {
  border: 1px solid rgba(255, 164, 104, 0.18);
  border-radius: 11px;
  background: rgba(12, 8, 16, 0.55);
  color: #f4e7de;
  padding: 9px 12px;
  font-size: 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: rgba(90, 200, 250, 0.4);
  box-shadow: 0 0 0 3px var(--ios-focus);
}

/* 覆盖上方全局 input/textarea，避免聊天输入框被加上圆角边框 */
.chat.card .composer .ios-composer-field textarea.composer-textarea {
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 14px 16px 16px;
}

.chat.card .composer .ios-composer-field textarea.composer-textarea:focus {
  border: none;
  box-shadow: none;
}

input[type="range"].ios-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 32px;
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

input[type="range"].ios-slider:focus {
  outline: none;
  box-shadow: none;
}

input[type="range"].ios-slider:focus-visible {
  outline: 2px solid rgba(90, 200, 250, 0.55);
  outline-offset: 3px;
  border-radius: 6px;
}

input[type="range"].ios-slider::-webkit-slider-runnable-track {
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.22));
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35) inset;
}

input[type="range"].ios-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 27px;
  height: 27px;
  margin-top: -11px;
  border-radius: 50%;
  background: linear-gradient(180deg, #ffffff, #f2f2f7);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.04),
    0 2px 6px rgba(0, 0, 0, 0.28),
    0 4px 12px rgba(0, 0, 0, 0.12);
  border: 0.5px solid rgba(0, 0, 0, 0.08);
}

input[type="range"].ios-slider:active::-webkit-slider-thumb {
  transform: scale(1.05);
}

input[type="range"].ios-slider::-moz-range-track {
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.22));
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35) inset;
}

input[type="range"].ios-slider::-moz-range-thumb {
  width: 27px;
  height: 27px;
  border-radius: 50%;
  border: 0.5px solid rgba(0, 0, 0, 0.08);
  background: linear-gradient(180deg, #ffffff, #f2f2f7);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.04),
    0 2px 6px rgba(0, 0, 0, 0.28);
}

button {
  cursor: pointer;
  border-radius: 11px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
}

button:active:not(:disabled) {
  transform: scale(0.98);
}

button.primary,
button.ios-btn-primary {
  border-color: var(--btn-border, rgba(255, 157, 89, 0.55));
  background: var(--btn-bg, linear-gradient(175deg, #e9a060, #cf5f35));
  color: var(--btn-text, #2a130c);
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(207, 95, 53, 0.35);
}

button.danger,
button.ios-btn-danger {
  border-color: var(--danger-border, rgba(255, 125, 125, 0.45));
  background: var(--danger-bg, rgba(112, 40, 48, 0.5));
  color: var(--danger-text, #fde7e7);
}

button.ios-btn-secondary {
  border: 1px solid var(--ios-hairline);
  background: rgba(255, 255, 255, 0.06);
  color: #f0e4dc;
  font-weight: 600;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
}

button.ios-btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
  transform: none;
}

@media (max-width: 1024px) {
  .flowbar {
    grid-template-columns: 1fr;
  }

  .workbench {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .page {
    padding: 12px;
  }

  .toolbar,
  .composer-foot {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* Hero toggle positioned to header top-right */
.hero-toggle {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(18,12,17,0.88);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,164,104,0.14);
  border-radius: 11px;
  z-index: 60;
  cursor: pointer;
  transition: transform 180ms ease, background 180ms ease;
}
.hero-toggle:hover { transform: scale(1.04); }
.hero.collapsed .hero-toggle { top: 8px; right: 8px; }


/* Launch overlay animation */
.launch-overlay {
  position: fixed;
  left: 65%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 200;
  pointer-events: none;
}

.launch-title {
  font-size: 72px;
  font-weight: 900;
  color: #fdebe0;
  text-shadow: 0 8px 24px rgba(0,0,0,0.6);
  animation: launch-anim 3s cubic-bezier(.2,.9,.2,1) forwards;
}

@keyframes launch-anim {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  10% { transform: translate(-50%, -50%) scale(3.4); opacity: 1; }
  83.333% { transform: translate(-50%, -50%) scale(3.4); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(3.4); opacity: 0; }
}

/* Thinking loader */
.thinking { display: inline-flex; gap: 6px; align-items: center; padding: 6px 4px; }
.thinking .dot { width: 8px; height: 8px; border-radius: 50%; background: #e98f47; opacity: 0.9; display: inline-block; transform: translateY(0); }
.thinking .dot:nth-child(1) { animation: dot-bounce 1s infinite 0s; }
.thinking .dot:nth-child(2) { animation: dot-bounce 1s infinite 0.12s; }
.thinking .dot:nth-child(3) { animation: dot-bounce 1s infinite 0.24s; }

@keyframes dot-bounce { 0% { transform: translateY(0); opacity: 0.4 } 40% { transform: translateY(-6px); opacity: 1 } 80% { transform: translateY(0); opacity: 0.6 } 100% { transform: translateY(0); opacity: 0.4 } }

.brand-title.pulse { animation: brand-pulse 420ms ease; }
@keyframes brand-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.12); } 100% { transform: scale(1); } }

/* hero expand/shrink animations */
.hero.animating-expand .brand-title { animation: hero-expand 420ms cubic-bezier(.2,.9,.2,1); }
.hero.animating-shrink .brand-title { animation: hero-shrink 360ms cubic-bezier(.2,.9,.2,1); }
@keyframes hero-expand { 0% { transform: scale(0.96); } 50% { transform: scale(1.12); } 100% { transform: scale(1); } }
@keyframes hero-shrink { 0% { transform: scale(1); } 50% { transform: scale(0.9); } 100% { transform: scale(1); } }

/* settings expand/shrink animations */
.settings.animating-expand { animation: settings-expand 420ms cubic-bezier(.2,.9,.2,1); }
.settings.animating-shrink { animation: settings-shrink 360ms cubic-bezier(.2,.9,.2,1); }
@keyframes settings-expand { 0% { transform: scaleX(0.96); opacity: 0.92; } 50% { transform: scaleX(1.03); opacity: 1; } 100% { transform: scaleX(1); opacity: 1; } }
@keyframes settings-shrink { 0% { transform: scaleX(1); opacity: 1 } 50% { transform: scaleX(0.86); opacity: 0.9 } 100% { transform: scaleX(1); opacity: 1; } }

</style>
