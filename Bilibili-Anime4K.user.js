// ==UserScript==
// @name         Bilibili Anime4K
// @name:en      Bilibili Anime4K
// @namespace    https://github.com/PYPTsca/Bilibili-Anime4K
// @homepageURL  https://github.com/PYPTsca/Bilibili-Anime4K
// @supportURL   https://github.com/PYPTsca/Bilibili-Anime4K/issues
// @downloadURL  https://raw.githubusercontent.com/PYPTsca/Bilibili-Anime4K/main/Bilibili-Anime4K.user.js
// @updateURL    https://raw.githubusercontent.com/PYPTsca/Bilibili-Anime4K/main/Bilibili-Anime4K.user.js
// @author       PYPTsca, net2cn, bloc97 and Anime4K contributors
// @version      3.0.0
// @description  在 B 站视频/番剧的视频播放器上启用 Anime4K WebGL 实时画质增强，支持 A/B/C 模式、次要模式、S–UL 质量档位与分场景配置。
// @description:en  Real-time Anime4K WebGL enhancement for Bilibili video/anime player, with A/B/C mode system and per-scene profiles.
// @copyright    2019 bloc97 (Anime4K); net2cn (Bilibili_Anime4K); 2026 PYPTsca
// @license      MIT
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%226%22%20fill%3D%22%23000%22%2F%3E%3Ctext%20x%3D%2216%22%20y%3D%2221%22%20font-family%3D%22Arial%22%20font-size%3D%2212%22%20font-weight%3D%22bold%22%20fill%3D%22%23fff%22%20text-anchor%3D%22middle%22%3E4K%3C%2Ftext%3E%3C%2Fsvg%3E
// @match        *://www.bilibili.com/*
// @match        *://player.bilibili.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    // ---------------------------------------------------------------------------
    // 0. 环境检查
    // ---------------------------------------------------------------------------

    const VERSION = "3.0.0";
    const TEST_MODE = /[?&]bilia4k-test=1(?:&|$)/.test(location.search);
    const UI_HOST_ATTR = "data-bilia4k-ui";

    // 在页面脚本之前抢占 wheel 捕获，避免在全屏滚动设置面板时被 B 站调成音量。
    window.addEventListener(
        "wheel",
        (e) => {
            if (typeof e.composedPath !== "function") return;
            const path = e.composedPath();
            for (let i = 0; i < path.length; i++) {
                const n = path[i];
                if (
                    n &&
                    n.nodeType === 1 &&
                    typeof n.hasAttribute === "function" &&
                    n.hasAttribute(UI_HOST_ATTR)
                ) {
                    e.stopImmediatePropagation();
                    return;
                }
            }
        },
        { capture: true, passive: false },
    );

    function isChromium() {
        const brands =
            navigator.userAgentData && navigator.userAgentData.brands;
        if (brands && brands.length) {
            return brands.some((b) =>
                /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand || ""),
            );
        }
        return /Chrome\/\d+/.test(navigator.userAgent);
    }

    if (!isChromium()) {
        console.info(
            "[Bilibili-Anime4K] 仅支持 Chromium 内核浏览器（Chrome / Edge），已退出。",
        );
        return;
    }

    // ---------------------------------------------------------------------------
    // 1. 工具函数
    // ---------------------------------------------------------------------------

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const toInt = (v, d) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.round(n) : d;
    };
    const now = () => performance.now();

    function createNode(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }

    function storageGet(key, fallback) {
        try {
            if (typeof GM_getValue === "function") {
                const v = GM_getValue(key);
                return v === undefined ? fallback : v;
            }
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function storageSet(key, value) {
        try {
            if (typeof GM_setValue === "function") GM_setValue(key, value);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            /* 存储失败不阻塞播放 */
        }
    }

    // ---------------------------------------------------------------------------
    // 2. 配置模型
    // ---------------------------------------------------------------------------

    const STORAGE_KEY = "bilia4k.config.v3";
    const PROFILE_KEYS = ["video", "bangumi"];
    const PROFILE_LABEL = { video: "普通视频", bangumi: "番剧" };
    const MODE_LABEL = { A: "A", B: "B", C: "C" };
    const SECONDARY_LABEL = { none: "无", A: "A", B: "B", C: "C" };
    const VARIANT_LABEL = { S: "S", M: "M", L: "L", VL: "VL", UL: "UL" };
    const FILTER_LABEL = {
        bilinear: "双线性",
        bicubic: "双三次",
        lanczos3: "Lanczos3",
    };

    const MODE_PARAMS = {
        A: {
            thin: true,
            thinK: 1.0,
            refine: true,
            refineK: 1.0,
            denoise: false,
            denoiseK: 0,
            thresholdBias: -0.02,
        },
        B: {
            thin: true,
            thinK: 0.65,
            refine: true,
            refineK: 0.8,
            denoise: false,
            denoiseK: 0,
            thresholdBias: 0.05,
        },
        C: {
            thin: false,
            thinK: 0,
            refine: false,
            refineK: 0,
            denoise: true,
            denoiseK: 0.55,
            thresholdBias: 0,
        },
    };

    const VARIANT_SCALE = { S: 0.8, M: 1.0, L: 1.2, VL: 1.45, UL: 1.75 };

    const BASE_CONFIG = Object.freeze({
        enabled: false,
        mode: "A",
        secondary: "A",
        variant: "UL",
        strength: 80,
        output: "2160",
        fps: 30,
        fxaa: false,
        upscale: "lanczos3",
        sharpen: 60,
        lineThreshold: 85,
        perfGuard: false,
        showStats: false,
        forceHdr: false,
    });

    function defaultConfig(profile) {
        return Object.assign({}, BASE_CONFIG, {
            enabled: profile === "bangumi",
        });
    }

    function normalizeConfig(raw, profile) {
        const base = defaultConfig(profile);
        if (!raw || typeof raw !== "object") return base;

        if (typeof raw.enabled === "boolean") base.enabled = raw.enabled;

        if (raw.mode === "A" || raw.mode === "B" || raw.mode === "C") {
            base.mode = raw.mode;
        } else if (raw.mode === "light") {
            base.mode = "C";
            base.secondary = "none";
            base.variant = "S";
        } else if (raw.mode === "standard") {
            base.mode = "A";
            base.secondary = "none";
            base.variant = "M";
        } else if (raw.mode === "high") {
            base.mode = "A";
            base.secondary = "A";
            base.variant = "M";
        }

        if (
            raw.secondary === "none" ||
            raw.secondary === "A" ||
            raw.secondary === "B" ||
            raw.secondary === "C"
        ) {
            base.secondary = raw.secondary;
        }
        if (
            raw.variant === "S" ||
            raw.variant === "M" ||
            raw.variant === "L" ||
            raw.variant === "VL" ||
            raw.variant === "UL"
        ) {
            base.variant = raw.variant;
        }
        if (
            raw.output === "auto" ||
            raw.output === "native" ||
            ["1080", "1440", "2160"].includes(String(raw.output))
        ) {
            base.output = String(raw.output);
        }
        if (
            raw.fps === "auto" ||
            raw.fps === 30 ||
            raw.fps === "30" ||
            raw.fps === 60 ||
            raw.fps === "60"
        ) {
            base.fps = raw.fps === "auto" ? "auto" : Number(raw.fps);
        }
        if (typeof raw.fxaa === "boolean") base.fxaa = raw.fxaa;
        if (
            raw.upscale === "bilinear" ||
            raw.upscale === "bicubic" ||
            raw.upscale === "lanczos3"
        ) {
            base.upscale = raw.upscale;
        }
        if (typeof raw.perfGuard === "boolean") base.perfGuard = raw.perfGuard;
        if (typeof raw.showStats === "boolean") base.showStats = raw.showStats;
        if (typeof raw.forceHdr === "boolean") base.forceHdr = raw.forceHdr;

        base.strength = clamp(toInt(raw.strength, base.strength), 0, 100);
        base.sharpen = clamp(toInt(raw.sharpen, base.sharpen), 0, 100);
        base.lineThreshold = clamp(
            toInt(raw.lineThreshold, base.lineThreshold),
            0,
            100,
        );
        return base;
    }

    class Settings {
        constructor() {
            this.profile = detectProfile();
            this.data = this.load();
        }

        load() {
            const raw = storageGet(STORAGE_KEY, null);
            const out = {};
            for (const key of PROFILE_KEYS) {
                out[key] = normalizeConfig(raw && raw[key], key);
            }
            return out;
        }

        get current() {
            return this.data[this.profile];
        }

        update(patch) {
            const merged = Object.assign({}, this.current, patch || {});
            this.data[this.profile] = normalizeConfig(merged, this.profile);
            storageSet(STORAGE_KEY, this.data);
        }

        reset() {
            this.data[this.profile] = defaultConfig(this.profile);
            storageSet(STORAGE_KEY, this.data);
        }
    }

    function detectProfile() {
        const path = location.pathname || "/";
        if (
            path.indexOf("/bangumi/play/") === 0 ||
            path.indexOf("/bangumi/") === 0
        )
            return "bangumi";
        if (location.hostname === "player.bilibili.com") {
            const q = new URLSearchParams(location.search);
            if (q.has("epId") || q.has("epid") || q.has("seasonId"))
                return "bangumi";
        }
        return "video";
    }

    // ---------------------------------------------------------------------------
    // 3. GLSL 着色器
    // ---------------------------------------------------------------------------

    const VERT = `
precision highp float;
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
    v_uv = a_pos;
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

    const SCALE_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_src;
uniform vec2 u_dst;
uniform int u_filter;
uniform float u_axis;
varying vec2 v_uv;

vec4 sampleAt(vec2 p) {
    return texture2D(u_tex, (p + 0.5) / u_src);
}

float cubicWeight(float x) {
    x = abs(x);
    if (x <= 1.0) return 1.5 * x * x * x - 2.5 * x * x + 1.0;
    if (x < 2.0) return -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0;
    return 0.0;
}

float sincf(float x) {
    if (abs(x) < 1e-5) return 1.0;
    float p = x * 3.141592653589793;
    return sin(p) / p;
}

float lanczosWeight(float x) {
    x = abs(x);
    if (x >= 3.0) return 0.0;
    return sincf(x) * sincf(x / 3.0);
}

vec4 doAxis(vec2 srcPos, float c, float ratio) {
    if (u_filter == 0) {
        float f = floor(c);
        float t = c - f;
        vec4 a = (u_axis < 0.5) ? sampleAt(vec2(f, srcPos.y)) : sampleAt(vec2(srcPos.x, f));
        vec4 b = (u_axis < 0.5) ? sampleAt(vec2(f + 1.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f + 1.0));
        return mix(a, b, t);
    }
    if (u_filter == 1) {
        float f = floor(c);
        float t = c - f;
        float w0 = cubicWeight(-1.0 - t);
        float w1 = cubicWeight(-t);
        float w2 = cubicWeight(1.0 - t);
        float w3 = cubicWeight(2.0 - t);
        vec4 acc = vec4(0.0);
        acc += ((u_axis < 0.5) ? sampleAt(vec2(f - 1.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f - 1.0))) * w0;
        acc += ((u_axis < 0.5) ? sampleAt(vec2(f, srcPos.y)) : sampleAt(vec2(srcPos.x, f))) * w1;
        acc += ((u_axis < 0.5) ? sampleAt(vec2(f + 1.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f + 1.0))) * w2;
        acc += ((u_axis < 0.5) ? sampleAt(vec2(f + 2.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f + 2.0))) * w3;
        float wsum = w0 + w1 + w2 + w3;
        return acc / (abs(wsum) < 1e-4 ? 1.0 : wsum);
    }
    float f = floor(c);
    float w0 = lanczosWeight((f - 2.0 - c) / ratio);
    float w1 = lanczosWeight((f - 1.0 - c) / ratio);
    float w2 = lanczosWeight((f - c) / ratio);
    float w3 = lanczosWeight((f + 1.0 - c) / ratio);
    float w4 = lanczosWeight((f + 2.0 - c) / ratio);
    float w5 = lanczosWeight((f + 3.0 - c) / ratio);
    vec4 acc = vec4(0.0);
    acc += ((u_axis < 0.5) ? sampleAt(vec2(f - 2.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f - 2.0))) * w0;
    acc += ((u_axis < 0.5) ? sampleAt(vec2(f - 1.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f - 1.0))) * w1;
    acc += ((u_axis < 0.5) ? sampleAt(vec2(f, srcPos.y)) : sampleAt(vec2(srcPos.x, f))) * w2;
    acc += ((u_axis < 0.5) ? sampleAt(vec2(f + 1.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f + 1.0))) * w3;
    acc += ((u_axis < 0.5) ? sampleAt(vec2(f + 2.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f + 2.0))) * w4;
    acc += ((u_axis < 0.5) ? sampleAt(vec2(f + 3.0, srcPos.y)) : sampleAt(vec2(srcPos.x, f + 3.0))) * w5;
    float wsum = w0 + w1 + w2 + w3 + w4 + w5;
    return acc / (abs(wsum) < 1e-4 ? 1.0 : wsum);
}

void main() {
    vec2 srcPos = (v_uv * u_dst + 0.5) * (u_src / u_dst) - 0.5;
    float c = (u_axis < 0.5) ? srcPos.x : srcPos.y;
    float ratio = (u_axis < 0.5) ? max(1.0, u_src.x / u_dst.x) : max(1.0, u_src.y / u_dst.y);
    gl_FragColor = doAxis(srcPos, c, ratio);
}
`;

    const THIN_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_pt;
uniform float u_strength;
varying vec2 v_uv;

float getLum(vec4 rgb) {
    return (rgb.r + rgb.r + rgb.g + rgb.g + rgb.g + rgb.b) / 6.0;
}

vec4 getRGBL(vec2 pos) {
    vec4 c = texture2D(u_tex, pos);
    return vec4(c.rgb, getLum(c));
}

vec4 getLargest(vec4 cc, vec4 lightestColor, vec4 a, vec4 b, vec4 c) {
    vec4 newColor = cc * (1.0 - u_strength) + ((a + b + c) / 3.0) * u_strength;
    return newColor.a > lightestColor.a ? newColor : lightestColor;
}

float min3v(vec4 a, vec4 b, vec4 c) {
    return min(min(a.a, b.a), c.a);
}

float max3v(vec4 a, vec4 b, vec4 c) {
    return max(max(a.a, b.a), c.a);
}

void main() {
    vec2 pos = v_uv;
    vec2 d = u_pt;

    vec4 cc = getRGBL(pos);
    vec4 t = getRGBL(pos + vec2(0.0, -d.y));
    vec4 tl = getRGBL(pos + vec2(-d.x, -d.y));
    vec4 tr = getRGBL(pos + vec2(d.x, -d.y));
    vec4 l = getRGBL(pos + vec2(-d.x, 0.0));
    vec4 r = getRGBL(pos + vec2(d.x, 0.0));
    vec4 b = getRGBL(pos + vec2(0.0, d.y));
    vec4 bl = getRGBL(pos + vec2(-d.x, d.y));
    vec4 br = getRGBL(pos + vec2(d.x, d.y));

    vec4 lightestColor = cc;

    float maxDark = max3v(br, b, bl);
    float minLight = min3v(tl, t, tr);
    if (minLight > cc.a && minLight > maxDark + 0.02) {
        lightestColor = getLargest(cc, lightestColor, tl, t, tr);
    }
    else {
        maxDark = max3v(tl, t, tr);
        minLight = min3v(br, b, bl);
        if (minLight > cc.a && minLight > maxDark + 0.02) {
            lightestColor = getLargest(cc, lightestColor, br, b, bl);
        }
    }

    maxDark = max3v(cc, l, b);
    minLight = min3v(r, t, tr);
    if (minLight > maxDark + 0.02) {
        lightestColor = getLargest(cc, lightestColor, r, t, tr);
    }
    else {
        maxDark = max3v(cc, r, t);
        minLight = min3v(bl, l, b);
        if (minLight > maxDark + 0.02) {
            lightestColor = getLargest(cc, lightestColor, bl, l, b);
        }
    }

    maxDark = max3v(l, tl, bl);
    minLight = min3v(r, br, tr);
    if (minLight > cc.a && minLight > maxDark + 0.02) {
        lightestColor = getLargest(cc, lightestColor, r, br, tr);
    }
    else {
        maxDark = max3v(r, br, tr);
        minLight = min3v(l, tl, bl);
        if (minLight > cc.a && minLight > maxDark + 0.02) {
            lightestColor = getLargest(cc, lightestColor, l, tl, bl);
        }
    }

    maxDark = max3v(cc, l, t);
    minLight = min3v(r, br, b);
    if (minLight > maxDark + 0.02) {
        lightestColor = getLargest(cc, lightestColor, r, br, b);
    }
    else {
        maxDark = max3v(cc, r, b);
        minLight = min3v(t, l, tl);
        if (minLight > maxDark + 0.02) {
            lightestColor = getLargest(cc, lightestColor, t, l, tl);
        }
    }

    gl_FragColor = vec4(lightestColor.rgb, 1.0);
}
`;

    const LUMA_FRAG = `
precision highp float;
uniform sampler2D u_tex;
varying vec2 v_uv;

float getLum(vec4 rgb) {
  return (rgb.r + rgb.r + rgb.g + rgb.g + rgb.g + rgb.b) / 6.0;
}

void main() {
  float lum = getLum(texture2D(u_tex, v_uv));
  gl_FragColor = vec4(lum, lum, lum, 1.0);
}
`;

    const GAUSS_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_pt;
uniform float u_axis;
varying vec2 v_uv;

void main() {
  vec2 d = (u_axis < 0.5) ? vec2(u_pt.x, 0.0) : vec2(0.0, u_pt.y);
  vec2 p = v_uv;
  float g = texture2D(u_tex, p - d * 2.0).x * 0.187691;
  g += texture2D(u_tex, p - d).x * 0.206038;
  g += texture2D(u_tex, p).x * 0.212543;
  g += texture2D(u_tex, p + d).x * 0.206038;
  g += texture2D(u_tex, p + d * 2.0).x * 0.187691;
  gl_FragColor = vec4(clamp(g, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

    const DETECT_FRAG = `
precision highp float;
uniform sampler2D u_luma;
uniform sampler2D u_blur;
uniform float u_threshold;
varying vec2 v_uv;

void main() {
  float lum = clamp(texture2D(u_luma, v_uv).x, 0.001, 0.999);
  float blur = clamp(texture2D(u_blur, v_uv).x, 0.001, 0.999);
  float p = clamp(1.0 - lum / blur, 0.0, 1.0);
  p = smoothstep(u_threshold, min(1.0, u_threshold + 0.35), p);
  gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
}
`;

    const REFINE_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_prob;
uniform vec2 u_pt;
uniform float u_strength;
varying vec2 v_uv;

float getLum(vec4 rgb) {
    return (rgb.r + rgb.r + rgb.g + rgb.g + rgb.g + rgb.b) / 6.0;
}

vec4 getRGBL(vec2 pos) {
    vec4 c = texture2D(u_tex, pos);
    return vec4(c.rgb, getLum(c));
}

float min3v(vec4 a, vec4 b, vec4 c) {
    return min(min(a.a, b.a), c.a);
}

float max3v(vec4 a, vec4 b, vec4 c) {
    return max(max(a.a, b.a), c.a);
}

vec4 getAverage(vec4 cc, vec4 a, vec4 b, vec4 c, float strength) {
    vec4 mixed = cc * (1.0 - strength) + ((a + b + c) / 3.0) * strength;
    return vec4(mixed.rgb, 1.0);
}

void main() {
    vec2 pos = v_uv;
    vec2 d = u_pt;

    vec4 cc = getRGBL(pos);
    vec4 t = getRGBL(pos + vec2(0.0, -d.y));
    vec4 tl = getRGBL(pos + vec2(-d.x, -d.y));
    vec4 tr = getRGBL(pos + vec2(d.x, -d.y));
    vec4 l = getRGBL(pos + vec2(-d.x, 0.0));
    vec4 r = getRGBL(pos + vec2(d.x, 0.0));
    vec4 b = getRGBL(pos + vec2(0.0, d.y));
    vec4 bl = getRGBL(pos + vec2(-d.x, d.y));
    vec4 br = getRGBL(pos + vec2(d.x, d.y));

    float prob = clamp(texture2D(u_prob, pos).x * 1.6, 0.0, 1.0);
    float avg8 = (tl.a + t.a + tr.a + l.a + r.a + bl.a + b.a + br.a) / 8.0;
    float dark = clamp((avg8 - cc.a) * 10.0, 0.0, 1.0);
    float strength = clamp(u_strength * prob * dark, 0.0, 1.0);

    // 仅在“中心比两侧都暗”的细线像素上还原，避免把大面积暗部整体提亮。
    bool darkH = cc.a + 0.012 < min(t.a, b.a);
    bool darkV = cc.a + 0.012 < min(l.a, r.a);
    bool darkD1 = cc.a + 0.012 < min(tl.a, br.a);
    bool darkD2 = cc.a + 0.012 < min(tr.a, bl.a);
    if (!(darkH || darkV || darkD1 || darkD2)) {
        gl_FragColor = vec4(cc.rgb, 1.0);
        return;
    }

    float maxDark = max3v(br, b, bl);
    float minLight = min3v(tl, t, tr);
    if (minLight > cc.a && minLight > maxDark + 0.02) {
        gl_FragColor = getAverage(cc, tl, t, tr, strength);
        return;
    }
    else {
        maxDark = max3v(tl, t, tr);
        minLight = min3v(br, b, bl);
        if (minLight > cc.a && minLight > maxDark + 0.02) {
            gl_FragColor = getAverage(cc, br, b, bl, strength);
            return;
        }
    }

    maxDark = max3v(cc, l, b);
    minLight = min3v(r, t, tr);
    if (minLight > maxDark + 0.02) {
        gl_FragColor = getAverage(cc, r, t, tr, strength);
        return;
    }
    else {
        maxDark = max3v(cc, r, t);
        minLight = min3v(bl, l, b);
        if (minLight > maxDark + 0.02) {
            gl_FragColor = getAverage(cc, bl, l, b, strength);
            return;
        }
    }

    maxDark = max3v(l, tl, bl);
    minLight = min3v(r, br, tr);
    if (minLight > cc.a && minLight > maxDark + 0.02) {
        gl_FragColor = getAverage(cc, r, br, tr, strength);
        return;
    }
    else {
        maxDark = max3v(r, br, tr);
        minLight = min3v(l, tl, bl);
        if (minLight > cc.a && minLight > maxDark + 0.02) {
            gl_FragColor = getAverage(cc, l, tl, bl, strength);
            return;
        }
    }

    maxDark = max3v(cc, l, t);
    minLight = min3v(r, br, b);
    if (minLight > maxDark + 0.02) {
        gl_FragColor = getAverage(cc, r, br, b, strength);
        return;
    }
    else {
        maxDark = max3v(cc, r, b);
        minLight = min3v(t, l, tl);
        if (minLight > maxDark + 0.02) {
            gl_FragColor = getAverage(cc, t, l, tl, strength);
            return;
        }
    }

    gl_FragColor = vec4(cc.rgb, 1.0);
}
`;

    const FXAA_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
varying vec2 v_uv;

float lum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec4 cc = texture2D(u_tex, v_uv);
    vec3 nw = texture2D(u_tex, v_uv + vec2(-1.0, -1.0) * u_texel).rgb;
    vec3 ne = texture2D(u_tex, v_uv + vec2(1.0, -1.0) * u_texel).rgb;
    vec3 sw = texture2D(u_tex, v_uv + vec2(-1.0, 1.0) * u_texel).rgb;
    vec3 se = texture2D(u_tex, v_uv + vec2(1.0, 1.0) * u_texel).rgb;

    float lNW = lum(nw);
    float lNE = lum(ne);
    float lSW = lum(sw);
    float lSE = lum(se);
    float lC = lum(cc.rgb);
    float lMin = min(lC, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lC, max(max(lNW, lNE), max(lSW, lSE)));

    if (lMax - lMin < max(0.03125, lMax * 0.125)) {
        gl_FragColor = cc;
        return;
    }

    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * u_texel;

    vec3 rgbA = 0.5 * (
        texture2D(u_tex, v_uv + dir * (-1.0 / 6.0)).rgb +
        texture2D(u_tex, v_uv + dir * (1.0 / 6.0)).rgb
        );
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture2D(u_tex, v_uv + dir * -0.5).rgb +
        texture2D(u_tex, v_uv + dir * 0.5).rgb
        );

    float lB = lum(rgbB);
    gl_FragColor = vec4(((lB < lMin) || (lB > lMax)) ? rgbA : rgbB, 1.0);
}
`;

    const SHARPEN_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_amount;
varying vec2 v_uv;

void main() {
    vec4 c = texture2D(u_tex, v_uv);
    vec3 n = texture2D(u_tex, v_uv + vec2(0.0, -u_texel.y)).rgb;
    vec3 s = texture2D(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb;
    vec3 e = texture2D(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb;
    vec3 w = texture2D(u_tex, v_uv + vec2(-u_texel.x, 0.0)).rgb;
    vec3 blur = (n + s + e + w) * 0.25;
    vec3 outColor = c.rgb + (c.rgb - blur) * u_amount;
    gl_FragColor = vec4(clamp(outColor, 0.0, 1.0), 1.0);
}
`;

    const DENOISE_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_pt;
uniform float u_strength;
varying vec2 v_uv;

float getLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec4 cc = texture2D(u_tex, v_uv);
    vec3 n = texture2D(u_tex, v_uv + vec2(0.0, -u_pt.y)).rgb;
    vec3 s = texture2D(u_tex, v_uv + vec2(0.0, u_pt.y)).rgb;
    vec3 w = texture2D(u_tex, v_uv + vec2(-u_pt.x, 0.0)).rgb;
    vec3 e = texture2D(u_tex, v_uv + vec2(u_pt.x, 0.0)).rgb;
    vec3 nw = texture2D(u_tex, v_uv + vec2(-u_pt.x, -u_pt.y)).rgb;
    vec3 ne = texture2D(u_tex, v_uv + vec2(u_pt.x, -u_pt.y)).rgb;
    vec3 sw = texture2D(u_tex, v_uv + vec2(-u_pt.x, u_pt.y)).rgb;
    vec3 se = texture2D(u_tex, v_uv + vec2(u_pt.x, u_pt.y)).rgb;

    vec3 avg = (n + s + w + e + nw + ne + sw + se) / 8.0;
    float diff = abs(getLum(cc.rgb) - getLum(avg));
    float flat_ = 1.0 - smoothstep(0.02, 0.10, diff);
    vec3 outp = mix(cc.rgb, avg, clamp(u_strength * flat_, 0.0, 1.0));
    gl_FragColor = vec4(outp, 1.0);
}
`;

    const DRAW_FRAG = `
precision highp float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main() {
    gl_FragColor = vec4(texture2D(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, 1.0);
}
`;

    // ---------------------------------------------------------------------------
    // 4. WebGL 渲染器
    // ---------------------------------------------------------------------------

    function compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error("Shader compile failed: " + log);
        }
        return shader;
    }

    function createProgram(gl, vsSource, fsSource) {
        const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error("Program link failed: " + log);
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        const uniforms = {};
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const info = gl.getActiveUniform(program, i);
            uniforms[info.name] = gl.getUniformLocation(program, info.name);
        }
        return {
            program,
            uniforms,
            aPos: gl.getAttribLocation(program, "a_pos"),
        };
    }

    class Renderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.gl = canvas.getContext("webgl", {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                premultipliedAlpha: false,
                preserveDrawingBuffer: false,
                powerPreference: "high-performance",
            });
            if (!this.gl) throw new Error("WebGL unavailable");

            const gl = this.gl;
            this.info = { renderer: "", vendor: "", maxTexture: 0 };
            const dbg = gl.getExtension("WEBGL_debug_renderer_info");
            if (dbg) {
                this.info.renderer =
                    gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
                this.info.vendor =
                    gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "";
            }
            this.info.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            this.software = /swiftshader|software|llvmpipe|basic render/i.test(
                this.info.renderer,
            );

            this.tw = 0;
            this.th = 0;
            this.vw = 0;
            this.vh = 0;

            this.programs = {
                scale: createProgram(gl, VERT, SCALE_FRAG),
                thin: createProgram(gl, VERT, THIN_FRAG),
                luma: createProgram(gl, VERT, LUMA_FRAG),
                gauss: createProgram(gl, VERT, GAUSS_FRAG),
                detect: createProgram(gl, VERT, DETECT_FRAG),
                refine: createProgram(gl, VERT, REFINE_FRAG),
                denoise: createProgram(gl, VERT, DENOISE_FRAG),
                fxaa: createProgram(gl, VERT, FXAA_FRAG),
                sharpen: createProgram(gl, VERT, SHARPEN_FRAG),
                draw: createProgram(gl, VERT, DRAW_FRAG),
            };

            this.quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
                gl.STATIC_DRAW,
            );

            this.fb = gl.createFramebuffer();
            this.videoTex = null;
            this.tmpX = null;
            this.texA = null;
            this.texB = null;
            this.texP = null;
            this.texT = null;

            this.frames = 0;
            this.fps = 0;
            this.fpsMark = now();
            this.lastProbe = null;
            this.probeHandlers = [];
            this.contextLost = false;

            gl.disable(gl.BLEND);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.STENCIL_TEST);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        }

        configure(cfg) {
            this.cfg = cfg;
            this.filterIndex =
                cfg.upscale === "bilinear"
                    ? 0
                    : cfg.upscale === "lanczos3"
                      ? 2
                      : 1;
        }

        _tex(w, h) {
            const gl = this.gl;
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_WRAP_S,
                gl.CLAMP_TO_EDGE,
            );
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_WRAP_T,
                gl.CLAMP_TO_EDGE,
            );
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                w,
                h,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                null,
            );
            gl.bindTexture(gl.TEXTURE_2D, null);
            return { tex, width: w, height: h };
        }

        _deleteTex(t) {
            if (!t) return;
            this.gl.deleteTexture(t.tex);
        }

        resize(tw, th, vw, vh) {
            if (
                tw === this.tw &&
                th === this.th &&
                vw === this.vw &&
                vh === this.vh
            )
                return;
            this.tw = tw;
            this.th = th;
            this.vw = vw;
            this.vh = vh;
            this.canvas.width = tw;
            this.canvas.height = th;

            const gl = this.gl;
            for (const key of [
                "videoTex",
                "tmpX",
                "texA",
                "texB",
                "texP",
                "texT",
            ]) {
                this._deleteTex(this[key]);
                this[key] = null;
            }
            this.videoTex = this._tex(vw, vh);
            this.tmpX = this._tex(tw, vh);
            this.texA = this._tex(tw, th);
            this.texB = this._tex(tw, th);
            this.texP = this._tex(tw, th);
            this.texT = this._tex(tw, th);
            gl.viewport(0, 0, tw, th);
            this.fpsMark = now();
            this.frames = 0;
        }

        _pool() {
            return [this.texA, this.texB, this.texP, this.texT];
        }

        _bind(tex) {
            const gl = this.gl;
            gl.bindFramebuffer(gl.FRAMEBUFFER, tex ? this.fb : null);
            if (tex) {
                gl.framebufferTexture2D(
                    gl.FRAMEBUFFER,
                    gl.COLOR_ATTACHMENT0,
                    gl.TEXTURE_2D,
                    tex.tex,
                    0,
                );
                gl.viewport(0, 0, tex.width, tex.height);
            } else {
                gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            }
        }

        _pass(prog, dst, sources, setUniforms) {
            const gl = this.gl;
            gl.useProgram(prog.program);
            this._bind(dst);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.enableVertexAttribArray(prog.aPos);
            gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
            for (let i = 0; i < sources.length; i++) {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, sources[i].tex);
            }
            setUniforms(prog.uniforms, gl);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        _upload(video) {
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, this.videoTex.tex);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                video,
            );
        }

        _runStage(img, params, gain) {
            if (!params || (!params.thin && !params.refine && !params.denoise))
                return img;
            const cfg = this.cfg;
            if (!cfg) return img;
            const pool = this._pool();
            const free = pool.filter((t) => t !== img);

            if (params.denoise) {
                const out = free[0];
                const strength = clamp(
                    params.denoiseK *
                        (0.45 + (cfg.strength / 100) * 0.55) *
                        gain,
                    0,
                    1,
                );
                this._pass(this.programs.denoise, out, [img], (u, g) => {
                    g.uniform1i(u.u_tex, 0);
                    g.uniform2f(u.u_pt, 1 / out.width, 1 / out.height);
                    g.uniform1f(u.u_strength, strength);
                });
                return out;
            }

            const L = free[0];
            const G = free[1];
            const B = free[2];

            this._pass(this.programs.luma, L, [img], (u, g) => {
                g.uniform1i(u.u_tex, 0);
            });
            this._pass(this.programs.gauss, G, [L], (u, g) => {
                g.uniform1i(u.u_tex, 0);
                g.uniform2f(u.u_pt, 1 / G.width, 1 / G.height);
                g.uniform1f(u.u_axis, 0.0);
            });
            this._pass(this.programs.gauss, B, [G], (u, g) => {
                g.uniform1i(u.u_tex, 0);
                g.uniform2f(u.u_pt, 1 / B.width, 1 / B.height);
                g.uniform1f(u.u_axis, 1.0);
            });

            const sens = clamp(cfg.lineThreshold / 100, 0, 1);
            const threshold = clamp(
                0.02 + (1 - sens) * 0.43 + params.thresholdBias,
                0.01,
                0.6,
            );
            this._pass(this.programs.detect, G, [L, B], (u, g) => {
                g.uniform1i(u.u_luma, 0);
                g.uniform1i(u.u_blur, 1);
                g.uniform1f(u.u_threshold, threshold);
            });

            const scaleK = clamp(this.th / Math.max(1, this.vh) / 6, 0.14, 1.0);
            const thinStrength = clamp(
                (cfg.strength / 100) * scaleK * 1.15 * params.thinK * gain,
                0,
                1,
            );
            const refineStrength = clamp(
                (cfg.strength / 100) * 0.5 * params.refineK * gain,
                0,
                1,
            );

            let base = img;
            if (params.thin && thinStrength > 0.001) {
                this._pass(this.programs.thin, L, [img], (u, g) => {
                    g.uniform1i(u.u_tex, 0);
                    g.uniform2f(u.u_pt, 1 / L.width, 1 / L.height);
                    g.uniform1f(u.u_strength, thinStrength);
                });
                base = L;
            }

            if (params.refine && refineStrength > 0.001) {
                this._pass(this.programs.refine, B, [base, G], (u, g) => {
                    g.uniform1i(u.u_tex, 0);
                    g.uniform1i(u.u_prob, 1);
                    g.uniform2f(u.u_pt, 1 / B.width, 1 / B.height);
                    g.uniform1f(u.u_strength, refineStrength);
                });
                return B;
            }
            return base;
        }

        render(video) {
            const gl = this.gl;
            if (!this.texA || !this.texP || this.contextLost) return;
            const cfg = this.cfg;
            if (!cfg) return;

            this._upload(video);

            this._pass(
                this.programs.scale,
                this.tmpX,
                [this.videoTex],
                (u, g) => {
                    g.uniform1i(u.u_tex, 0);
                    g.uniform2f(
                        u.u_src,
                        this.videoTex.width,
                        this.videoTex.height,
                    );
                    g.uniform2f(u.u_dst, this.tmpX.width, this.tmpX.height);
                    g.uniform1i(u.u_filter, this.filterIndex);
                    g.uniform1f(u.u_axis, 0.0);
                },
            );
            this._pass(this.programs.scale, this.texA, [this.tmpX], (u, g) => {
                g.uniform1i(u.u_tex, 0);
                g.uniform2f(u.u_src, this.tmpX.width, this.tmpX.height);
                g.uniform2f(u.u_dst, this.texA.width, this.texA.height);
                g.uniform1i(u.u_filter, this.filterIndex);
                g.uniform1f(u.u_axis, 1.0);
            });

            let img = this.texA;
            img = this._runStage(
                img,
                MODE_PARAMS[cfg.mode] || MODE_PARAMS.A,
                1.0,
            );
            if (cfg.secondary !== "none") {
                img = this._runStage(
                    img,
                    MODE_PARAMS[cfg.secondary] || MODE_PARAMS.A,
                    0.85,
                );
            }

            const pickDst = () => this._pool().filter((t) => t !== img)[0];

            if (cfg.fxaa) {
                const dst = pickDst();
                this._pass(this.programs.fxaa, dst, [img], (u, g) => {
                    g.uniform1i(u.u_tex, 0);
                    g.uniform2f(u.u_texel, 1 / dst.width, 1 / dst.height);
                });
                img = dst;
            }

            if (cfg.sharpen > 0) {
                const dst = pickDst();
                this._pass(this.programs.sharpen, dst, [img], (u, g) => {
                    g.uniform1i(u.u_tex, 0);
                    g.uniform2f(u.u_texel, 1 / dst.width, 1 / dst.height);
                    g.uniform1f(u.u_amount, (cfg.sharpen / 100) * 1.2);
                });
                img = dst;
            }

            this._pass(this.programs.draw, null, [img], (u, g) => {
                g.uniform1i(u.u_tex, 0);
            });

            this.frames++;
            const t = now();
            if (t - this.fpsMark >= 1000) {
                this.fps = (this.frames * 1000) / (t - this.fpsMark);
                this.frames = 0;
                this.fpsMark = t;
            }

            if (this.probeHandlers.length) this._finishProbe();
        }

        _finishProbe() {
            const gl = this.gl;
            const w = this.canvas.width;
            const h = this.canvas.height;
            const buf = new Uint8Array(4);
            const read = (fx, fy) => {
                gl.readPixels(
                    Math.floor(w * fx),
                    Math.floor(h * fy),
                    1,
                    1,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    buf,
                );
                return [buf[0], buf[1], buf[2], buf[3]];
            };
            const result = {
                width: w,
                height: h,
                center: read(0.5, 0.5),
                topLeft: read(0.1, 0.9),
                topRight: read(0.9, 0.9),
                bottomLeft: read(0.1, 0.1),
                fps: this.fps,
            };
            this.lastProbe = result;
            const handlers = this.probeHandlers.splice(0);
            for (const fn of handlers) fn(result);
        }

        probe() {
            return new Promise((resolve) => {
                this.probeHandlers.push(resolve);
                if (this.cfg) this.probeRequested = true;
            });
        }

        probeGpu() {
            const gl = this.gl;
            const start = now();
            gl.finish();
            return now() - start;
        }

        dispose() {
            const gl = this.gl;
            for (const key of [
                "videoTex",
                "tmpX",
                "texA",
                "texB",
                "texP",
                "texT",
            ])
                this._deleteTex(this[key]);
            for (const key of Object.keys(this.programs))
                gl.deleteProgram(this.programs[key].program);
            gl.deleteBuffer(this.quad);
            gl.deleteFramebuffer(this.fb);
            const lose = gl.getExtension("WEBGL_lose_context");
            if (lose) {
                try {
                    lose.loseContext();
                } catch (e) {}
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 5. UI
    // ---------------------------------------------------------------------------

    const PANEL_HTML = `
<style>
    :host {
        all: initial;
    }

    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    .wrap {
        position: relative;
        width: 32px;
        height: 32px;
        pointer-events: auto;
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #fff;
        -webkit-font-smoothing: antialiased;
    }

    .btn {
        position: relative;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        pointer-events: auto;
        border: 1px solid rgba(255, 255, 255, .45);
        background: #000;
        color: #fff;
        font: 700 11px/1 "Segoe UI", "Microsoft YaHei", sans-serif;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: .5;
        transition: opacity .18s, border-color .18s, box-shadow .18s;
        padding: 0;
        outline: none;
    }

    .btn:hover {
        opacity: 1;
    }

    .wrap.awake .btn,
    .wrap.open .btn {
        opacity: 1;
    }

    .wrap.idle {
        pointer-events: none;
    }

    .wrap.idle .btn {
        opacity: 0;
        pointer-events: none;
    }

    .wrap.on .btn {
        border-color: #fff;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .28);
    }

    .wrap.off .btn .txt {
        opacity: .55;
    }

    .dot {
        position: absolute;
        right: -1px;
        bottom: -1px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #555;
        border: 1px solid #000;
    }

    .wrap.on .dot {
        background: #fff;
    }

    .wrap.warn .dot {
        background: #e6c229;
    }

    .wrap.err .dot {
        background: #e5484d;
    }

    .panel {
        display: none;
        position: absolute;
        left: 0;
        top: 40px;
        width: 278px;
        pointer-events: auto;
        max-height: min(72vh, 540px);
        overflow: auto;
        background: #000;
        border: 1px solid #2b2b2b;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, .75);
        padding: 10px 12px 9px;
    }

    .wrap.open .panel {
        display: block;
    }

    .panel::-webkit-scrollbar {
        width: 6px;
    }

    .panel::-webkit-scrollbar-thumb {
        background: #2f2f2f;
        border-radius: 3px;
    }

    .head {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 7px;
    }

    .brand {
        font-weight: 700;
        font-size: 13px;
        letter-spacing: .2px;
    }

    .ver {
        color: #5a5a5a;
        font-size: 10px;
        font-weight: 400;
    }

    .chip {
        font-size: 10px;
        line-height: 1;
        padding: 3px 6px;
        border: 1px solid #3a3a3a;
        border-radius: 99px;
        color: #b9b9b9;
        white-space: nowrap;
    }

    .chip.on {
        color: #fff;
        border-color: #8a8a8a;
    }

    .close {
        margin-left: auto;
        width: 22px;
        height: 22px;
        border: 0;
        background: transparent;
        color: #8a8a8a;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        padding: 0;
    }

    .close:hover {
        color: #fff;
    }

    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 5px 0;
        border-top: 1px solid #141414;
    }

    .row:nth-of-type(1) {
        border-top: 0;
    }

    .row.col {
        display: block;
    }

    .lab {
        color: #d8d8d8;
        font-size: 12px;
    }

    .labline {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
    }

    .val {
        color: #8a8a8a;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }

    .seg {
        display: flex;
        border: 1px solid #2e2e2e;
        border-radius: 7px;
        overflow: hidden;
        margin-top: 5px;
    }

    .seg button {
        flex: 1;
        background: #000;
        border: 0;
        color: #9a9a9a;
        padding: 5px 0;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        outline: none;
    }

    .seg button.on {
        background: #fff;
        color: #000;
    }

    select {
        background: #000;
        border: 1px solid #333;
        color: #fff;
        border-radius: 6px;
        padding: 3px 6px;
        font: inherit;
        font-size: 11px;
        outline: none;
    }

    input[type=range] {
        width: 100%;
        margin: 6px 0 0;
        accent-color: #fff;
        height: 16px;
    }

    .sw {
        position: relative;
        display: inline-block;
        width: 34px;
        height: 18px;
        flex: 0 0 auto;
    }

    .sw input {
        position: absolute;
        opacity: 0;
        inset: 0;
        margin: 0;
        cursor: pointer;
    }

    .sw i {
        position: absolute;
        inset: 0;
        background: #242424;
        border: 1px solid #3a3a3a;
        border-radius: 99px;
        transition: .15s;
        pointer-events: none;
    }

    .sw i::after {
        content: "";
        position: absolute;
        left: 2px;
        top: 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #777;
        transition: .15s;
    }

    .sw input:checked+i {
        background: #fff;
        border-color: #fff;
    }

    .sw input:checked+i::after {
        left: 18px;
        background: #000;
    }

    details.adv {
        margin-top: 6px;
        border-top: 1px solid #141414;
        padding-top: 6px;
    }

    details.adv summary {
        cursor: pointer;
        color: #9a9a9a;
        font-size: 11px;
        list-style: none;
    }

    details.adv[open] summary {
        color: #fff;
        margin-bottom: 2px;
    }

    details.adv summary::-webkit-details-marker {
        display: none;
    }

    details.adv .arrow {
        display: inline-block;
        margin-right: 4px;
        font-size: 9px;
        transition: transform .15s;
        transform-origin: 50% 50%;
    }

    details.adv[open] .arrow {
        transform: rotate(90deg);
    }

    .info {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: 1px solid #4a4a4a;
        color: #8a8a8a;
        font-size: 9px;
        line-height: 1;
        cursor: help;
        margin-left: 3px;
        vertical-align: 1px;
        font-style: normal;
        font-weight: 400;
    }

    .info:hover {
        color: #fff;
        border-color: #999;
    }

    .tip {
        position: fixed;
        z-index: 2147483647;
        max-width: 238px;
        padding: 7px 9px;
        background: #000;
        border: 1px solid #333;
        border-radius: 6px;
        color: #ddd;
        font: 11px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        box-shadow: 0 8px 20px rgba(0, 0, 0, .7);
        pointer-events: none;
        display: none;
        white-space: normal;
    }

    .tip.show {
        display: block;
    }

    .warnline {
        display: none;
        margin: 7px 0 0;
        padding: 5px 7px;
        border: 1px solid #4a3f12;
        background: #171204;
        color: #e6c229;
        font-size: 11px;
        border-radius: 6px;
    }

    .warnline.show {
        display: block;
    }

    .stats-chip {
        display: none;
        position: absolute;
        left: 40px;
        top: 3px;
        padding: 3px 7px;
        background: rgba(0, 0, 0, .72);
        border: 1px solid #2b2b2b;
        border-radius: 6px;
        color: #d8d8d8;
        font: 10px/1.3 "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;
        white-space: nowrap;
        pointer-events: none;
        font-variant-numeric: tabular-nums;
    }

    .stats-chip.show {
        display: block;
    }

    .toast {
        color: #9a9a9a;
        font-size: 10px;
        margin-top: 6px;
        min-height: 13px;
    }

    .foot {
        display: flex;
        gap: 8px;
        margin-top: 8px;
    }

    .foot button {
        flex: 1;
        background: #111;
        border: 1px solid #333;
        color: #ccc;
        font: inherit;
        font-size: 11px;
        padding: 5px 0;
        border-radius: 6px;
        cursor: pointer;
    }

    .foot button:hover {
        background: #1c1c1c;
        color: #fff;
    }
</style>

<div class="wrap">
    <button class="btn" type="button" title="Anime4K 设置"><span class="txt">4K</span><i class="dot"></i></button>
    <div class="panel" role="dialog" aria-label="Anime4K 设置">
        <div class="head">
            <span class="brand">Anime4K</span><span class="ver">v3</span>
            <span class="chip prof">普通视频</span>
            <span class="chip state">已关闭</span>
            <button class="close" type="button" title="关闭">×</button>
        </div>
        <div class="row">
            <span class="lab">启用滤镜</span>
            <label class="sw"><input type="checkbox" data-k="enabled"><i></i></label>
        </div>
        <div class="row col">
            <div class="labline">
                <span class="lab">主模式
                    <span class="info"
                        data-tip="A：针对高模糊、压缩伪影较多的 1080p 动画，线条还原最强。B：针对中等伪影的 720p 或部分 1080p，还原更克制、保留纹理。C：针对本身干净的高质量源，只做轻降噪和放大，不做线条重建。">i</span>
                </span>
            </div>
            <div class="seg" data-seg="mode">
                <button type="button" data-v="A">A</button>
                <button type="button" data-v="B">B</button>
                <button type="button" data-v="C">C</button>
            </div>
        </div>
        <div class="row col">
            <div class="labline">
                <span class="lab">次要模式
                    <span class="info"
                        data-tip="在第一层之后再叠加一层还原，可单独选择 A/B/C。A+A 效果最强也最慢；B+B 更保守；C 可前置降噪。选“无”只跑一层。">i</span>
                </span>
            </div>
            <div class="seg" data-seg="secondary">
                <button type="button" data-v="none">无</button>
                <button type="button" data-v="A">A</button>
                <button type="button" data-v="B">B</button>
                <button type="button" data-v="C">C</button>
            </div>
        </div>
        <div class="row col">
            <div class="labline">
                <span class="lab">质量档位
                    <span class="info"
                        data-tip="近似 Anime4K 的 CNN 变体：S 最快；每升一档内部超采样倍率更高、线条更干净，GPU 开销约翻倍（S 0.8× / M 1× / L 1.2× / VL 1.45× / UL 1.75×）。">i</span>
                </span>
            </div>
            <div class="seg" data-seg="variant">
                <button type="button" data-v="S">S</button>
                <button type="button" data-v="M">M</button>
                <button type="button" data-v="L">L</button>
                <button type="button" data-v="VL">VL</button>
                <button type="button" data-v="UL">UL</button>
            </div>
        </div>
        <div class="row col">
            <div class="labline">
                <span class="lab">还原强度
                    <span class="info" data-tip="线条还原与细化的总幅度。越高线条越细越亮，画质提升越明显；过高会发灰、出现振铃。">i</span>
                    <span class="val" data-out="strength">80%</span>
                </span>
            </div>
            <input type="range" data-k="strength" min="0" max="100" step="5">
        </div>
        <div class="row">
            <span class="lab">输出分辨率
                <span class="info" data-tip="自动按播放器尺寸在 1440P–2160P 间选择；2160P 会做超采样。质量档位会在此基础上再乘内部倍率。">i</span>
            </span>
            <select data-k="output">
                <option value="auto">自动</option>
                <option value="native">原生</option>
                <option value="1080">1080P</option>
                <option value="1440">1440P</option>
                <option value="2160">2160P</option>
            </select>
        </div>
        <div class="row col">
            <span class="lab">帧率上限
                <span class="info" data-tip="渲染帧率上限。24fps 动画用 30 足够；60 更跟手，但 GPU 压力更大。">i</span>
            </span>
            <div class="seg" data-seg="fps">
                <button type="button" data-v="auto">自动</button>
                <button type="button" data-v="30">30</button>
                <button type="button" data-v="60">60</button>
            </div>
        </div>
        <details class="adv">
            <summary><span class="arrow">▸</span>高级参数</summary>
            <div class="row">
                <span class="lab">FXAA 抗锯齿
                    <span class="info" data-tip="边缘抗锯齿。开启更平滑，关闭更锐利但锯齿更明显。">i</span>
                </span>
                <label class="sw"><input type="checkbox" data-k="fxaa"><i></i></label>
            </div>
            <div class="row">
                <span class="lab">放大算法
                    <span class="info" data-tip="双线性最柔和、最快；双三次平衡；Lanczos3 最锐，可能产生白边。">i</span>
                </span>
                <select data-k="upscale">
                    <option value="bilinear">双线性</option>
                    <option value="bicubic">双三次</option>
                    <option value="lanczos3">Lanczos3</option>
                </select>
            </div>
            <div class="row col">
                <div class="labline">
                    <span class="lab">锐化
                        <span class="info" data-tip="后处理 unsharp。用于补偿还原带来的对比度下降，过高会出现白边/黑边。">i</span>
                    </span>
                    <span class="val" data-out="sharpen">60%</span>
                </div>
                <input type="range" data-k="sharpen" min="0" max="100" step="5">
            </div>
            <div class="row col">
                <div class="labline">
                    <span class="lab">线条检测灵敏度
                        <span class="info" data-tip="越高参与还原的线条越多，效果更明显，也更容易误伤纹理。">i</span>
                    </span>
                    <span class="val" data-out="lineThreshold">85%</span>
                </div>
                <input type="range" data-k="lineThreshold" min="0" max="100" step="5">
            </div>
            <div class="row">
                <span class="lab">性能保护
                    <span class="info" data-tip="单帧渲染超预算时自动降低内部渲染分辨率，避免掉帧。">i</span>
                </span>
                <label class="sw"><input type="checkbox" data-k="perfGuard"><i></i></label>
            </div>
            <div class="row">
                <span class="lab">显示统计
                    <span class="info" data-tip="在按钮右侧显示模式、分辨率、fps 与 GPU 耗时。">i</span>
                </span>
                <label class="sw"><input type="checkbox" data-k="showStats"><i></i></label>
            </div>
            <div class="row">
                <span class="lab">HDR 内容强制启用
                    <span class="info" data-tip="识别到 HDR/杜比内容时默认暂停；强制开启可能偏色。">i</span>
                </span>
                <label class="sw"><input type="checkbox" data-k="forceHdr"><i></i></label>
            </div>
        </details>
        <div class="warnline"></div>
        <div class="toast"></div>
        <div class="foot">
            <button type="button" data-act="reset">恢复默认</button>
            <button type="button" data-act="close">关闭面板</button>
        </div>
    </div>
</div>
<div class="stats-chip"></div>
<div class="tip"></div>
`;

    class UI {
        constructor(controller, root) {
            this.controller = controller;
            this.root = root;
            this.open = false;
            this.awake = false;
            this.hideTimer = 0;
            this.toastTimer = 0;
            this.suppressClickUntil = 0;

            this.host = document.createElement("div");
            this.host.setAttribute("data-bilia4k-ui", "");
            this.host.style.cssText =
                "position:absolute;left:12px;top:10px;z-index:2147483647;width:32px;height:32px;pointer-events:none;";
            this.shadow = this.host.attachShadow({ mode: "open" });
            this.shadow.innerHTML = PANEL_HTML;

            this.wrap = this.shadow.querySelector(".wrap");
            this.btn = this.shadow.querySelector(".btn");
            this.panel = this.shadow.querySelector(".panel");
            this.warnEl = this.shadow.querySelector(".warnline");
            this.statsChip = this.shadow.querySelector(".stats-chip");
            this.tip = this.shadow.querySelector(".tip");
            this.toastEl = this.shadow.querySelector(".toast");

            root.appendChild(this.host);
            this.bind();
            this.bindHover();
            this.refresh();

            this.statsTimer = setInterval(() => this.tick(), 500);
            this.pollTimer = setInterval(() => this.pollChrome(), 250);
        }

        bind() {
            this.btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (performance.now() < this.suppressClickUntil) return;
                this.setOpen(!this.open);
            });

            this.shadow
                .querySelector(".close")
                .addEventListener("click", () => this.setOpen(false));
            this.shadow
                .querySelector('[data-act="close"]')
                .addEventListener("click", () => this.setOpen(false));
            this.shadow
                .querySelector('[data-act="reset"]')
                .addEventListener("click", () => {
                    this.controller.reset();
                    this.toast("已恢复默认");
                });

            this.panel.addEventListener("pointerdown", (e) =>
                e.stopPropagation(),
            );
            this.panel.addEventListener("click", (e) => e.stopPropagation());
            this.panel.addEventListener("dblclick", (e) => e.stopPropagation());
            this.panel.addEventListener("wheel", (e) => e.stopPropagation(), {
                passive: true,
            });
            this.panel.addEventListener("contextmenu", (e) =>
                e.stopPropagation(),
            );
            this.panel.addEventListener("keydown", (e) => e.stopPropagation());
            this.panel.addEventListener("scroll", () => this.hideTip(), {
                passive: true,
            });

            this.panel.addEventListener("pointerover", (e) => {
                const info = e.target.closest(".info");
                if (info) this.showTip(info);
            });
            this.panel.addEventListener("pointerout", (e) => {
                const info = e.target.closest(".info");
                if (info) this.hideTip();
            });

            this.panel.addEventListener("click", (e) => {
                const btn = e.target.closest("button[data-v]");
                if (!btn) return;
                const seg = btn.closest("[data-seg]");
                if (!seg) return;
                const key = seg.getAttribute("data-seg");
                const value = btn.getAttribute("data-v");
                this.controller.update({
                    [key]:
                        key === "fps" && value !== "auto"
                            ? Number(value)
                            : value,
                });
            });

            this.panel.addEventListener("change", (e) => {
                const input = e.target;
                const key = input.getAttribute("data-k");
                if (!key) return;
                let value;
                if (input.type === "checkbox") value = input.checked;
                else if (input.type === "range") value = Number(input.value);
                else value = input.value;
                this.controller.update({ [key]: value });
            });

            this.panel.addEventListener("input", (e) => {
                const input = e.target;
                if (input.type !== "range") return;
                const key = input.getAttribute("data-k");
                if (!key) return;
                const out = this.shadow.querySelector(`[data-out="${key}"]`);
                if (out) out.textContent = input.value + "%";
                this.controller.update(
                    { [key]: Number(input.value) },
                    { refresh: false },
                );
            });

            document.addEventListener("keydown", this.onKeyDown, true);
            document.addEventListener(
                "pointerdown",
                this.onDocPointerDown,
                true,
            );
        }

        bindHover() {
            const show = () => {
                this.setAwake(true);
                this.scheduleHide();
            };
            this.root.addEventListener("pointerenter", show);
            this.root.addEventListener("pointermove", show, { passive: true });
            this.root.addEventListener("pointerleave", () =>
                this.scheduleHide(380),
            );
            this.root.addEventListener(
                "pointerdown",
                this.onRootPointerDown,
                true,
            );

            this.host.addEventListener("pointerenter", () => {
                this.setAwake(true);
                clearTimeout(this.hideTimer);
            });
            this.host.addEventListener("pointerleave", () =>
                this.scheduleHide(380),
            );
        }

        onKeyDown = (e) => {
            if (e.key === "Escape" && this.open) {
                e.preventDefault();
                e.stopPropagation();
                this.setOpen(false);
            }
        };

        // 兜底：即使按钮被播放器控件层覆盖，也能在捕获阶段按坐标命中并拦截。
        onRootPointerDown = (e) => {
            if (this.wrap.classList.contains("idle")) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const rect = this.btn.getBoundingClientRect();
            if (rect.width <= 0) return;
            if (
                e.clientX < rect.left ||
                e.clientX > rect.right ||
                e.clientY < rect.top ||
                e.clientY > rect.bottom
            ) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.suppressClickUntil = performance.now() + 400;
            this.setOpen(!this.open);
        };

        onDocPointerDown = (e) => {
            if (!this.open) return;
            const path = e.composedPath ? e.composedPath() : [];
            if (!path.includes(this.host)) this.setOpen(false);
        };

        setAwake(v) {
            this.awake = v;
            this.updateVisibility();
        }

        keepVisible() {
            return !!(
                this.controller.config && this.controller.config.showStats
            );
        }

        updateVisibility() {
            const active = this.awake || this.open || this.keepVisible();
            this.wrap.classList.toggle("awake", active);
            this.wrap.classList.toggle("idle", !active);
        }

        scheduleHide(ms = 2600) {
            if (this.open) return;
            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                if (!this.open) this.setAwake(false);
            }, ms);
        }

        showTip(el) {
            const text = el.getAttribute("data-tip");
            if (!text) return;
            this.tip.textContent = text;
            this.tip.classList.add("show");
            const r = el.getBoundingClientRect();
            const tw = this.tip.offsetWidth;
            const th = this.tip.offsetHeight;
            let left = clamp(
                r.left + r.width / 2 - tw / 2,
                8,
                innerWidth - tw - 8,
            );
            let top = r.top - th - 8;
            if (top < 8) top = r.bottom + 8;
            this.tip.style.left = left + "px";
            this.tip.style.top = top + "px";
        }

        hideTip() {
            if (this.tip) this.tip.classList.remove("show");
        }

        setOpen(v) {
            this.open = v;
            this.wrap.classList.toggle("open", v);
            if (v) {
                this.setAwake(true);
                this.refresh();
            } else {
                this.hideTip();
                this.scheduleHide(2600);
            }
        }

        pollChrome() {
            if (!this.host.isConnected) return;
            const root = this.root;
            const screen = root.getAttribute("data-screen");
            const shifted =
                !!document.fullscreenElement ||
                (!!screen && screen !== "normal");
            const top = shifted ? "56px" : "10px";
            if (this.host.style.top !== top) this.host.style.top = top;

            this.pollCount = (this.pollCount || 0) + 1;
            if (this.pollCount % 4 === 0) {
                const rect = this.btn.getBoundingClientRect();
                if (rect.width > 0) {
                    const hit = document.elementFromPoint(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                    );
                    const desc = !hit
                        ? "none"
                        : hit === this.host
                          ? "self"
                          : hit.tagName +
                            "." +
                            String(hit.className || "").slice(0, 80);
                    if (this.host.getAttribute("data-hit") !== desc)
                        this.host.setAttribute("data-hit", desc);
                }
            }

            if (this.open) return;
            const ctrl = root.querySelector(
                ".bpx-player-control-bottom, .bpx-player-control-wrap, .bilibili-player-video-control",
            );
            if (!ctrl) return;
            const cs = getComputedStyle(ctrl);
            if (cs.display === "none" || Number(cs.opacity) < 0.05) {
                this.setAwake(false);
            }
        }

        tick() {
            const t = performance.now();
            if (t - (this.lastTickAt || 0) < 450) return;
            this.lastTickAt = t;
            const status = this.controller.status();
            this.updateStats(status);
            if (!this.open) return;
            this.updateWarn(status);
        }

        updateStats(status) {
            const show = !!(this.controller.config.showStats && status.active);
            this.statsChip.classList.toggle("show", show);
            if (show) this.statsChip.textContent = this.controller.statsText();
        }

        toast(msg) {
            if (!this.toastEl) return;
            this.toastEl.textContent = msg;
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => {
                this.toastEl.textContent = "";
            }, 2600);
        }

        updateWarn(status) {
            const map = {
                webgl: "WebGL 不可用，滤镜已停用",
                software: "检测到软件渲染（SwiftShader），已停用",
                hdr: "HDR / 杜比内容，已暂停；可在高级里强制启用",
                context: "WebGL 上下文丢失，正在尝试恢复",
            };
            const text = status.blocked
                ? map[status.blocked] || "滤镜已暂停"
                : "";
            this.warnEl.textContent = text;
            this.warnEl.classList.toggle("show", !!text);
        }

        refresh() {
            if (!this.wrap) return;
            const cfg = this.controller.config;
            const status = this.controller.status();

            this.wrap.classList.toggle(
                "on",
                !!(cfg.enabled && !status.blocked),
            );
            this.wrap.classList.toggle(
                "off",
                !(cfg.enabled && !status.blocked),
            );
            this.wrap.classList.toggle(
                "warn",
                !!(status.blocked || status.attached === false),
            );
            this.wrap.classList.toggle(
                "err",
                status.blocked === "webgl" || status.blocked === "software",
            );

            this.shadow.querySelector(".prof").textContent =
                PROFILE_LABEL[this.controller.profile] || "普通视频";
            const stateChip = this.shadow.querySelector(".state");
            if (status.blocked) stateChip.textContent = "已暂停";
            else stateChip.textContent = cfg.enabled ? "已启用" : "已关闭";
            stateChip.classList.toggle("on", !!cfg.enabled && !status.blocked);

            const setCheck = (key, val) => {
                const input = this.shadow.querySelector(
                    `input[data-k="${key}"]`,
                );
                if (input) input.checked = val;
            };
            const setRange = (key, val) => {
                const input = this.shadow.querySelector(
                    `input[data-k="${key}"]`,
                );
                if (input && this.shadow.activeElement !== input)
                    input.value = String(val);
                const out = this.shadow.querySelector(`[data-out="${key}"]`);
                if (out) out.textContent = Math.round(val) + "%";
            };
            const setSelect = (key, val) => {
                const input = this.shadow.querySelector(
                    `select[data-k="${key}"]`,
                );
                if (input) input.value = String(val);
            };
            const setSeg = (key, val) => {
                const seg = this.shadow.querySelector(`[data-seg="${key}"]`);
                if (!seg) return;
                seg.querySelectorAll("button[data-v]").forEach((b) => {
                    b.classList.toggle(
                        "on",
                        b.getAttribute("data-v") === String(val),
                    );
                });
            };

            setCheck("enabled", !!cfg.enabled);
            setCheck("fxaa", !!cfg.fxaa);
            setCheck("perfGuard", !!cfg.perfGuard);
            setCheck("showStats", !!cfg.showStats);
            setCheck("forceHdr", !!cfg.forceHdr);
            setRange("strength", cfg.strength);
            setRange("sharpen", cfg.sharpen);
            setRange("lineThreshold", cfg.lineThreshold);
            setSelect("output", cfg.output);
            setSelect("upscale", cfg.upscale);
            setSeg("mode", cfg.mode);
            setSeg("secondary", cfg.secondary);
            setSeg("variant", cfg.variant);
            setSeg("fps", cfg.fps);

            this.updateWarn(status);
            this.updateStats(status);
            this.updateVisibility();
            this.lastTickAt = performance.now();
        }

        destroy() {
            clearInterval(this.statsTimer);
            clearInterval(this.pollTimer);
            clearTimeout(this.hideTimer);
            clearTimeout(this.toastTimer);
            document.removeEventListener("keydown", this.onKeyDown, true);
            document.removeEventListener(
                "pointerdown",
                this.onDocPointerDown,
                true,
            );
            this.root.removeEventListener(
                "pointerdown",
                this.onRootPointerDown,
                true,
            );
            if (this.host.parentElement)
                this.host.parentElement.removeChild(this.host);
        }
    }

    // ---------------------------------------------------------------------------
    // 6. 控制器
    // ---------------------------------------------------------------------------

    class Controller {
        constructor() {
            this.settings = new Settings();
            this.profile = this.settings.profile;
            this.video = null;
            this.wrap = null;
            this.uiRoot = null;
            this.canvas = null;
            this.host = null;
            this.renderer = null;
            this.ui = null;
            this.raf = 0;
            this.active = false;
            this.blocked = null;
            this.lastMediaTime = -1;
            this.forceRender = true;
            this.lastDrawTs = 0;
            this.renderCount = 0;
            this.perfStrikes = 0;
            this.perfScale = 1;
            this.autoFps = 30;
            this.refreshRate = 60;
            this.qualityLabel = "";
            this.hdr = false;
            this.scanTimer = 0;
            this.qualityTimer = 0;
            this.videoListeners = [];
            this.captureStream = false;
            this.lastError = null;
            this.lastProbe = null;
            this.lastGpuMs = 0;

            this.onLoadedMetadata = this.onLoadedMetadata.bind(this);
            this.onVideoResize = this.onVideoResize.bind(this);
            this.onSeeked = this.onSeeked.bind(this);
            this.onPlay = this.onPlay.bind(this);
            this.onVisibility = this.onVisibility.bind(this);
            this.onViewportChange = this.onViewportChange.bind(this);
            this.loop = this.loop.bind(this);

            this.api = this.createApi();
        }

        start() {
            this.scan();
            this.scanTimer = setInterval(() => this.scan(), 700);
            this.qualityTimer = setInterval(() => this.pollQuality(), 1600);
            document.addEventListener("visibilitychange", this.onVisibility);
            this.measureRefresh();
            if (typeof GM_registerMenuCommand === "function") {
                try {
                    GM_registerMenuCommand("Anime4K: 切换当前页面开关", () =>
                        this.toggle(),
                    );
                    GM_registerMenuCommand(
                        "Anime4K: 打开设置面板",
                        () => this.ui && this.ui.setOpen(true),
                    );
                    GM_registerMenuCommand("Anime4K: 重置当前页面配置", () =>
                        this.reset(),
                    );
                } catch (e) {}
            }
        }

        createApi() {
            const c = this;
            return {
                version: VERSION,
                get profile() {
                    return c.profile;
                },
                get config() {
                    return Object.assign({}, c.settings.current);
                },
                get status() {
                    return c.status();
                },
                set(patch) {
                    c.update(patch);
                },
                setEnabled(v) {
                    c.update({ enabled: !!v });
                },
                toggle() {
                    c.toggle();
                },
                reset() {
                    c.reset();
                },
                openPanel(v) {
                    if (c.ui) c.ui.setOpen(v !== false);
                },
                probe() {
                    if (!c.renderer) return Promise.resolve(null);
                    c.forceRender = true;
                    c.lastMediaTime = -1;
                    return c.renderer.probe();
                },
                get lastProbe() {
                    return c.renderer ? c.renderer.lastProbe : null;
                },
                rendererInfo() {
                    return c.renderer ? c.renderer.info : null;
                },
                get lastError() {
                    return c.lastError;
                },
            };
        }

        get config() {
            return this.settings.current;
        }

        status() {
            const cfg = this.config;
            return {
                profile: this.profile,
                attached: !!this.video,
                enabled: cfg.enabled,
                active: this.active,
                blocked: this.blocked,
                showStats: cfg.showStats,
                source: this.video
                    ? [this.video.videoWidth, this.video.videoHeight]
                    : null,
                target:
                    this.renderer && this.renderer.tw
                        ? [this.renderer.tw, this.renderer.th]
                        : null,
                fps: this.renderer ? Math.round(this.renderer.fps) : 0,
                hdr: this.hdr,
                quality: this.qualityLabel,
            };
        }

        statsText() {
            const s = this.status();
            const cfg = this.config;
            const parts = [];
            parts.push(
                cfg.mode +
                    (cfg.secondary !== "none" ? "+" + cfg.secondary : "") +
                    " " +
                    cfg.variant,
            );
            if (s.target) parts.push(s.target[0] + "×" + s.target[1]);
            if (this.video)
                parts.push(
                    "源 " +
                        this.video.videoWidth +
                        "×" +
                        this.video.videoHeight,
                );
            parts.push(s.fps + "fps");
            if (this.renderer)
                parts.push(
                    "GPU " +
                        (this.lastGpuMs ? this.lastGpuMs.toFixed(1) : "–") +
                        "ms",
                );
            return parts.join(" · ");
        }

        update(patch, opts) {
            const refresh = !opts || opts.refresh !== false;
            const before = Object.assign({}, this.config);
            this.settings.update(patch);
            const after = this.config;

            if (
                patch.enabled !== undefined &&
                before.enabled !== after.enabled
            ) {
                if (after.enabled) this.ensureStarted();
                else this.stopFilter();
            }
            if (this.renderer) this.renderer.configure(after);
            if ("forceHdr" in patch && after.enabled) {
                const wasBlocked = this.blocked;
                this.checkBlocked();
                if (this.blocked && !wasBlocked) this.stopFilter();
                else if (!this.blocked && wasBlocked) this.ensureStarted();
            }
            if (
                "output" in patch ||
                "mode" in patch ||
                "upscale" in patch ||
                "variant" in patch
            )
                this.layout(true);
            if (refresh && this.ui) this.ui.refresh();
        }

        toggle() {
            this.update({ enabled: !this.config.enabled });
        }

        reset() {
            this.settings.reset();
            this.perfScale = 1;
            this.perfStrikes = 0;
            if (this.renderer) this.renderer.configure(this.config);
            if (this.config.enabled) this.ensureStarted();
            else this.stopFilter();
            if (this.ui) {
                this.ui.refresh();
                this.toastSafe("已恢复默认");
            }
        }

        toastSafe(msg) {
            if (this.ui) this.ui.toast(msg);
        }

        measureRefresh() {
            let first = 0;
            let count = 0;
            const step = (t) => {
                if (!first) first = t;
                count++;
                if (count >= 40) {
                    const fps = Math.round((count * 1000) / (t - first));
                    this.refreshRate = fps || 60;
                    this.autoFps = clamp(
                        Math.round((this.refreshRate || 60) / 2),
                        30,
                        60,
                    );
                } else {
                    requestAnimationFrame(step);
                }
            };
            requestAnimationFrame(step);
        }

        // ---- 查找并挂载播放器 ----

        scan() {
            const profile = detectProfile();
            if (profile !== this.profile || profile !== this.settings.profile) {
                this.profile = profile;
                this.settings.profile = profile;
                this.applyProfileChange();
            }
            const found = this.findPlayer();
            if (!found) {
                if (this.video && !this.video.isConnected) this.detach();
                return;
            }
            if (
                found.video !== this.video ||
                found.root !== this.uiRoot ||
                found.video.parentElement !== this.wrap
            ) {
                this.detach();
                this.attach(found.root, found.video);
            }
        }

        applyProfileChange() {
            this.stopFilter();
            this.perfScale = 1;
            this.perfStrikes = 0;
            if (this.renderer) this.renderer.configure(this.config);
            if (this.config.enabled) this.ensureStarted();
            if (this.ui) this.ui.refresh();
        }

        findPlayer() {
            const videos = Array.from(document.querySelectorAll("video"));
            let best = null;
            let bestArea = 0;
            for (const video of videos) {
                const root =
                    video.closest(".bpx-player-container") ||
                    video.closest("#bilibili-player") ||
                    video.closest(".bilibili-player");
                if (!root) continue;
                if (video.closest(".bpx-player-mini")) continue;
                const rect = video.getBoundingClientRect();
                const area = Math.max(0, rect.width) * Math.max(0, rect.height);
                if (!best || area > bestArea) {
                    best = { video, root };
                    bestArea = area;
                }
            }
            return best;
        }

        attach(root, video) {
            if (!video.parentElement) return;
            this.video = video;
            this.uiRoot = root;
            this.wrap = video.parentElement;

            this.saveStyle(video, "visibility");
            this.saveStyle(this.wrap, "position");
            if (getComputedStyle(this.wrap).position === "static")
                this.wrap.style.position = "relative";

            this.canvas = document.createElement("canvas");
            this.canvas.className = "bilia4k-canvas";
            this.canvas.style.cssText =
                "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:none;";
            this.wrap.insertBefore(this.canvas, video.nextSibling);

            this.ui = new UI(this, root);
            this.bindVideo(video);

            this.ro = new ResizeObserver(() => this.scheduleLayout());
            this.ro.observe(this.wrap);
            window.addEventListener("resize", this.onViewportChange);
            document.addEventListener(
                "fullscreenchange",
                this.onViewportChange,
            );

            if (this.config.enabled) this.ensureStarted();
            this.layout();
        }

        saveStyle(el, prop) {
            if (!el.__bilia4kStyle) el.__bilia4kStyle = {};
            if (!(prop in el.__bilia4kStyle))
                el.__bilia4kStyle[prop] = el.style[prop] || "";
        }

        restoreStyle(el, prop) {
            if (!el || !el.__bilia4kStyle) return;
            if (prop in el.__bilia4kStyle)
                el.style[prop] = el.__bilia4kStyle[prop];
        }

        bindVideo(video) {
            this.unbindVideo();
            const add = (type, fn) => {
                video.addEventListener(type, fn);
                this.videoListeners.push([type, fn]);
            };
            add("loadedmetadata", this.onLoadedMetadata);
            add("resize", this.onVideoResize);
            add("seeked", this.onSeeked);
            add("play", this.onPlay);
            add("emptied", this.onVideoResize);
        }

        unbindVideo() {
            if (!this.video) return;
            for (const [type, fn] of this.videoListeners)
                this.video.removeEventListener(type, fn);
            this.videoListeners = [];
        }

        onLoadedMetadata() {
            this.layout(true);
            if (this.config.enabled) this.ensureStarted();
        }

        onVideoResize() {
            this.layout(true);
        }

        onSeeked() {
            this.forceRender = true;
            this.lastMediaTime = -1;
        }

        onPlay() {
            this.forceRender = true;
        }

        onVisibility() {
            if (!document.hidden) {
                this.forceRender = true;
                this.scheduleLayout();
            }
        }

        onViewportChange() {
            this.scheduleLayout();
            if (this.ui) this.ui.pollChrome();
        }

        scheduleLayout() {
            if (this.layoutQueued) return;
            this.layoutQueued = true;
            requestAnimationFrame(() => {
                this.layoutQueued = false;
                this.layout();
            });
        }

        detach() {
            this.stopFilter();
            this.unbindVideo();
            if (this.ro) {
                this.ro.disconnect();
                this.ro = null;
            }
            window.removeEventListener("resize", this.onViewportChange);
            document.removeEventListener(
                "fullscreenchange",
                this.onViewportChange,
            );
            if (this.ui) {
                this.ui.destroy();
                this.ui = null;
            }
            if (this.canvas && this.canvas.parentElement)
                this.canvas.parentElement.removeChild(this.canvas);
            this.canvas = null;
            if (this.renderer) {
                try {
                    this.renderer.dispose();
                } catch (e) {}
                this.renderer = null;
            }
            if (this.video) this.restoreStyle(this.video, "visibility");
            if (this.wrap) this.restoreStyle(this.wrap, "position");
            this.video = null;
            this.uiRoot = null;
            this.wrap = null;
            this.blocked = null;
            this.active = false;
            this.lastMediaTime = -1;
            this.forceRender = true;
            this.perfScale = 1;
            this.perfStrikes = 0;
        }

        ensureStarted() {
            if (!this.video || !this.canvas) return;
            if (!this.video.videoWidth) return;
            this.checkBlocked();
            if (this.blocked) {
                this.stopFilter();
                return;
            }
            if (!this.renderer) {
                try {
                    this.renderer = new Renderer(this.canvas);
                } catch (e) {
                    this.lastError = String(e && e.message ? e.message : e);
                    this.blocked = "webgl";
                    this.stopFilter();
                    if (this.ui) this.ui.refresh();
                    return;
                }
                if (this.renderer.software && !TEST_MODE) {
                    this.blocked = "software";
                    this.lastError =
                        "software renderer: " + this.renderer.info.renderer;
                    this.stopFilter();
                    if (this.ui) this.ui.refresh();
                    return;
                }
                this.renderer.configure(this.config);
            }
            this.renderer.configure(this.config);
            this.layout(true);
            this.canvas.style.display = "block";
            this.video.style.visibility = "hidden";
            this.active = true;
            this.forceRender = true;
            if (!this.raf) this.raf = requestAnimationFrame(this.loop);
            if (this.ui) this.ui.refresh();
        }

        stopFilter() {
            if (this.raf) {
                cancelAnimationFrame(this.raf);
                this.raf = 0;
            }
            this.active = false;
            if (this.video) this.restoreStyle(this.video, "visibility");
            if (this.canvas) this.canvas.style.display = "none";
        }

        checkBlocked() {
            if (!this.video) {
                this.blocked = null;
                return;
            }
            const label = this.readQualityLabel();
            this.qualityLabel = label;
            this.hdr = /HDR|杜比|Dolby/i.test(label);
            if (this.hdr && !this.config.forceHdr) {
                this.blocked = "hdr";
                return;
            }
            if (this.renderer && this.renderer.software && !TEST_MODE) {
                this.blocked = "software";
                return;
            }
            this.blocked = null;
        }

        readQualityLabel() {
            const el =
                (this.uiRoot &&
                    this.uiRoot.querySelector(
                        ".bpx-player-ctrl-quality-result",
                    )) ||
                document.querySelector(".bpx-player-ctrl-quality-result") ||
                document.querySelector(
                    ".bilibili-player-video-btn-quality-result",
                );
            return el ? (el.textContent || "").trim() : "";
        }

        pollQuality(force) {
            if (!this.video) return;
            const label = this.readQualityLabel();
            const hdr = /HDR|杜比|Dolby/i.test(label);
            if (!force && label === this.qualityLabel && hdr === this.hdr)
                return;
            this.qualityLabel = label;
            this.hdr = hdr;
            if (this.video.videoHeight) this.layout();
            if (this.config.enabled) {
                const wasBlocked = this.blocked;
                this.checkBlocked();
                if (this.blocked && !wasBlocked) this.stopFilter();
                else if (!this.blocked && wasBlocked) this.ensureStarted();
            }
            if (this.ui) this.ui.refresh();
        }

        layout(force) {
            if (!this.video || !this.canvas || !this.wrap) return;
            const rect = this.wrap.getBoundingClientRect();
            const vw = this.video.videoWidth;
            const vh = this.video.videoHeight;
            if (!vw || !vh || rect.width < 2 || rect.height < 2) return;

            const fit = getComputedStyle(this.video).objectFit;
            let w;
            let h;
            if (fit === "fill") {
                w = rect.width;
                h = rect.height;
            } else {
                const aspect = vw / vh;
                w = rect.width;
                h = w / aspect;
                if (h > rect.height) {
                    h = rect.height;
                    w = h * aspect;
                }
            }

            const left = (rect.width - w) / 2;
            const top = (rect.height - h) / 2;
            this.canvas.style.left = left + "px";
            this.canvas.style.top = top + "px";
            this.canvas.style.width = w + "px";
            this.canvas.style.height = h + "px";

            const target = this.computeTarget(h);
            if (
                force ||
                !this.renderer ||
                target.w !== this.renderer.tw ||
                target.h !== this.renderer.th ||
                vw !== this.renderer.vw ||
                vh !== this.renderer.vh
            ) {
                if (this.renderer) {
                    const safeW = Math.min(
                        target.w,
                        this.renderer.info.maxTexture || 4096,
                    );
                    const safeH = Math.min(
                        target.h,
                        this.renderer.info.maxTexture || 4096,
                    );
                    this.renderer.resize(safeW, safeH, vw, vh);
                    this.forceRender = true;
                }
            }
        }

        computeTarget(displayHeight) {
            const vw = this.video.videoWidth;
            const vh = this.video.videoHeight;
            const cfg = this.config;
            const dpr = window.devicePixelRatio || 1;
            let base;
            if (cfg.output === "native") base = vh;
            else if (cfg.output === "auto") {
                if (vh >= 2160) base = vh;
                else base = clamp(Math.round(displayHeight * dpr), 1440, 2160);
            } else base = Number(cfg.output);
            base = clamp(base, 240, 2160);
            const variantK = VARIANT_SCALE[cfg.variant] || 1;
            base = Math.round(base * variantK * this.perfScale);
            base = clamp(base, 240, 2880);
            let w = clamp(Math.round((base * vw) / vh), 2, 5120);
            if (w >= 5120) {
                w = 5120;
                base = clamp(Math.round((w * vh) / vw), 240, 2880);
            }
            return { w, h: base };
        }

        loop(ts) {
            if (!this.active) {
                this.raf = 0;
                return;
            }
            this.raf = requestAnimationFrame(this.loop);
            if (
                !this.video ||
                !this.renderer ||
                !this.config.enabled ||
                this.blocked
            )
                return;
            if (document.hidden) return;
            if (this.video.readyState < 2) return;

            const force =
                this.forceRender ||
                !!(this.renderer && this.renderer.probeHandlers.length);
            const newFrame = this.video.currentTime !== this.lastMediaTime;
            if (!newFrame && !force) return;
            if (this.video.paused && !force) return;

            const fps = this.effectiveFps();
            if (!force && fps && ts - this.lastDrawTs < 1000 / fps - 1) return;

            this.forceRender = false;
            this.lastMediaTime = this.video.currentTime;
            this.lastDrawTs = ts;
            try {
                this.renderer.render(this.video);
            } catch (e) {
                this.lastError = String(e && e.message ? e.message : e);
                this.blocked = "context";
                this.stopFilter();
                if (this.ui) this.ui.refresh();
                return;
            }

            this.renderCount++;
            if (this.config.perfGuard && this.renderCount % 45 === 0)
                this.checkPerf();
            if (this.ui) this.ui.tick();
        }

        effectiveFps() {
            const cfg = this.config;
            if (cfg.fps === "auto") return this.autoFps || 30;
            return Number(cfg.fps) || 30;
        }

        checkPerf() {
            if (!this.renderer || !this.video) return;
            try {
                const ms = this.renderer.probeGpu();
                this.lastGpuMs = ms;
                const budget = 1000 / this.effectiveFps();
                if (ms > budget * 0.85) {
                    this.perfStrikes++;
                    if (this.perfStrikes >= 2 && this.perfScale > 0.4) {
                        this.perfScale = Math.max(0.4, this.perfScale * 0.75);
                        this.perfStrikes = 0;
                        this.layout(true);
                        this.toastSafe("性能不足，已降低输出分辨率");
                    }
                } else {
                    this.perfStrikes = Math.max(0, this.perfStrikes - 1);
                }
            } catch (e) {}
        }
    }

    // ---------------------------------------------------------------------------
    // 7. 启动
    // ---------------------------------------------------------------------------

    function boot() {
        if (window.__BILI_A4K_BOOTED__) return;
        window.__BILI_A4K_BOOTED__ = true;
        try {
            const controller = new Controller();
            controller.start();
            window.__BILI_A4K__ = controller.api;
        } catch (e) {
            console.error("[Bilibili-Anime4K] 启动失败:", e);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
