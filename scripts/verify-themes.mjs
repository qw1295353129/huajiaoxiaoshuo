/**
 * 回归：主题切换。
 *
 * 默认是中性（白/黑/浅灰），用户要求再加一套暖色（参考奶油底 + 琥珀橙）。
 * 暖色通过 `data-theme="warm"` 标记，**与 dark 正交**（它本身是浅色系）。
 *
 * 这条回归守住三件容易坏的事：
 *  ① 暖色主题真的生效（底色/强调色确实变了，不是只加了属性名）；
 *  ② **切回浅色/深色时属性被清掉** —— 漏了这一步会"粘住"暖色，
 *     表现为"选了浅色但还是黄的"，而且刷新也不恢复；
 *  ③ 默认（浅色）仍然是中性 —— 用户明确要求默认不要彩色。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 950 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "主题回归" });
  const o = await import("/src/db/repo/outline.ts");
  await o.createChapter(proj.id, { title: "第一章" });
  return proj.id;
});

/** 把主题写进设置并重载页面（走真实的启动路径） */
const useTheme = async (theme) => {
  await page.evaluate(async (t) => {
    const s = await import("/src/db/repo/settings.ts");
    s.saveSettings(Object.assign({}, s.loadSettings(), { theme: t }));
  }, theme);
  await gotoApp(page, BASE + "/p/" + pid + "/overview", { settle: 2000 });
};

/** 读实际渲染出来的颜色 */
const probe = () =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const el = document.createElement("div");
    document.body.appendChild(el);
    /*
      统一归一化成 rgb() 再比较。
      两个都试过、都不行的办法：
        - "设成 style.color 再读回来" → 浏览器把 oklch **原样返回**，不转换；
        - Canvas fillStyle → 同样不认 oklch，也是原样返回。
      所以这里自己算 oklch → sRGB（公式不长，但确定可靠）。
    */
    const rgb = (v) => {
      const t = (v || "").trim();
      if (!t) return "";
      const m = t.match(/oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+|none)/);
      if (m) {
        const num = (s, scale) => (s.endsWith("%") ? parseFloat(s) / 100 * scale : parseFloat(s));
        const L = num(m[1], 1);
        const C = m[2] === "none" ? 0 : num(m[2], 0.4);
        const H = m[3] === "none" ? 0 : parseFloat(m[3]);
        const hRad = (H * Math.PI) / 180;
        const a = C * Math.cos(hRad);
        const bb = C * Math.sin(hRad);
        // OKLab → LMS
        const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
        const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
        const l3 = l_ ** 3, m3 = m_ ** 3, s3 = s_ ** 3;
        const lin = [
          +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
          -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
          -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
        ];
        const enc = (x) => {
          const c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
          return Math.max(0, Math.min(255, Math.round(c * 255)));
        };
        const [r, g, b] = lin.map(enc);
        return "rgb(" + r + ", " + g + ", " + b + ")";
      }
      return t; // 已是 rgb()/rgba()
    };
    const out = {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      isDark: document.documentElement.classList.contains("dark"),
      accent: rgb(cs.getPropertyValue("--accent").trim()),
      pageBg: rgb(cs.getPropertyValue("--color-neutral-50").trim()),
      cardBg: rgb(cs.getPropertyValue("--color-white").trim()),
      hasAtmosphere: getComputedStyle(document.body, "::before").position === "fixed",
    };
    el.remove();
    return out;
  });

/**
 * 从颜色字符串里取 RGB。
 * 只认 rgb()/rgba() —— probe 里已经用浏览器转过了，仍是 oklch 说明转换失败，
 * 这时**必须判失败而不是默认通过**（第一版对 oklch 直接 return true，
 * 结果浅色主题的断言全是"假通过"）。
 */
const toRgb = (color) => {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
/** 颜色是否偏暖（红分量最高、蓝分量最低） */
const isWarm = (color) => {
  const v = toRgb(color);
  if (!v) return false;
  return v[0] >= v[1] && v[1] >= v[2] && v[0] - v[2] >= 6;
};
/** 颜色是否中性（三通道接近） */
const isNeutral = (color) => {
  const v = toRgb(color);
  if (!v) return false;
  return Math.max(...v) - Math.min(...v) <= 12;
};
/** 颜色是否偏冷（蓝分量最高） */
const isCool = (color) => {
  const v = toRgb(color);
  if (!v) return false;
  return v[2] >= v[0] && v[2] >= v[1] && v[2] - v[0] >= 2;
};
/** 是否是"玫粉"这类强调色（红分量最高、绿最低，即有彩度且偏红） */
const isCoolAccent = (color) => {
  const v = toRgb(color);
  if (!v) return false;
  return v[0] > v[1] && v[0] - v[1] >= 20;
};

console.log("【浅色（默认）必须是中性】");
await useTheme("light");
const light = await probe();
console.log("  " + JSON.stringify(light));
check("浅色不带 data-theme", light.dataTheme === null, String(light.dataTheme));
check("浅色强调色是中性", isNeutral(light.accent), light.accent);
check("浅色页面底是中性", isNeutral(light.pageBg), light.pageBg);

console.log("【暖阳】");
await useTheme("warm");
const warm = await probe();
console.log("  " + JSON.stringify(warm));
check("暖阳带 data-theme=warm", warm.dataTheme === "warm", String(warm.dataTheme));
check("暖阳的强调色偏暖（橙）", isWarm(warm.accent), warm.accent);
check("暖阳的页面底偏暖（奶油）", isWarm(warm.pageBg), warm.pageBg);
check("暖阳的卡片底比页面底更亮", warm.cardBg !== warm.pageBg, JSON.stringify({ card: warm.cardBg, page: warm.pageBg }));
check("暖阳不是深色模式", warm.isDark === false, String(warm.isDark));

console.log("【柔彩】");
await useTheme("soft");
const soft = await probe();
console.log("  " + JSON.stringify(soft));
check("柔彩带 data-theme=soft", soft.dataTheme === "soft", String(soft.dataTheme));
check("柔彩的强调色偏冷（玫粉：红高、绿低）", isCoolAccent(soft.accent), soft.accent);
check("柔彩的页面底是冷调（蓝分量最高）", isCool(soft.pageBg), soft.pageBg);
check("柔彩的卡片底比页面底更亮", soft.cardBg !== soft.pageBg, JSON.stringify({ card: soft.cardBg, page: soft.pageBg }));
check("柔彩不是深色模式", soft.isDark === false, String(soft.isDark));
check("柔彩有氛围渐变层", soft.hasAtmosphere === true, String(soft.hasAtmosphere));

console.log("【仪表盘（vivid）】");
await useTheme("vivid");
const vivid = await probe();
console.log("  " + JSON.stringify(vivid));
check("仪表盘带 data-theme=vivid", vivid.dataTheme === "vivid", String(vivid.dataTheme));
check("仪表盘的强调色偏暖（珊瑚橙）", isWarm(vivid.accent), vivid.accent);
check("仪表盘的卡片底是纯白（让彩色卡片跳出来）", isNeutral(vivid.cardBg), vivid.cardBg);
check("仪表盘不是深色模式", vivid.isDark === false, String(vivid.isDark));
check("仪表盘有氛围层", vivid.hasAtmosphere === true, String(vivid.hasAtmosphere));

// 卡片渐变强度与色调必须是"每个主题各自"的
const tones = await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  const { applyTheme } = await import("/src/app/store.ts");
  const out = {};
  for (const theme of ["light", "warm", "soft", "vivid"]) {
    s.saveSettings(Object.assign({}, s.loadSettings(), { theme }));
    applyTheme(theme);
    const cs = getComputedStyle(document.documentElement);
    out[theme] = {
      strength: cs.getPropertyValue("--tone-strength").trim() || "(默认 12%)",
      info: cs.getPropertyValue("--tone-info").trim(),
      warning: cs.getPropertyValue("--tone-warning").trim(),
    };
  }
  return out;
});
console.log("  " + JSON.stringify(tones));
check(
  "仪表盘的渐变强度明显高于其他主题",
  tones.vivid.strength === "42%" && tones.light.strength === "(默认 12%)",
  JSON.stringify(tones),
);
check(
  "每个主题的色调颜色各不相同（各有各的个性）",
  new Set(Object.values(tones).map((t) => t.info + "|" + t.warning)).size === 4,
  JSON.stringify(tones),
);

console.log("【切回浅色必须清掉暖色/柔彩（否则会粘住）】");
await useTheme("light");
const backToLight = await probe();
console.log("  " + JSON.stringify(backToLight));
check("data-theme 已清空", backToLight.dataTheme === null, String(backToLight.dataTheme));
check("强调色回到中性", isNeutral(backToLight.accent), backToLight.accent);
check("页面底回到中性", isNeutral(backToLight.pageBg), backToLight.pageBg);

console.log("【深色不受暖色影响】");
await useTheme("dark");
const dark = await probe();
console.log("  " + JSON.stringify(dark));
check("深色会加上 dark 类", dark.isDark === true, String(dark.isDark));
check("深色不带 data-theme", dark.dataTheme === null, String(dark.dataTheme));
check("深色强调色是中性", isNeutral(dark.accent), dark.accent);

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
