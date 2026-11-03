/*!
 * UiGenBridge — panel <-> host MCP bridge adapter for the hba-uigen panel.
 *
 * Protocol (reverse-engineered from the official ZCode pdf-plugin):
 *  - The panel runs as an mcp-app iframe ("text/html;profile=mcp-app").
 *  - It is an MCP *client*: newline-free JSON-RPC 2.0 envelopes are exchanged
 *    with the host over window.parent.postMessage(msg, "*") and the window
 *    "message" event (see pdf-plugin dist/ui bundle: transport constructor
 *    `new ...Transport(window.parent, window.parent)`).
 *  - Handshake: MCP "initialize" -> "notifications/initialized" -> custom
 *    request "ui/initialize" { appInfo, appCapabilities, protocolVersion }.
 *  - "tools/call" reaches the plugin MCP server declared in
 *    plugin.json ui.surfaces[].server ("hba-uigen").
 *  - "notifications/progress" carries generation progress
 *    (params: { progressToken, progress, total, message }).
 *  - "notifications/resources/updated" carries resource change pushes
 *    (host-side ops pluginUi.resourceUpdated / pluginUi.resourceListChanged).
 *  - "ui/notifications/host-context-changed" carries partial host context
 *    increments (may contain only { theme: "light" | "dark" }); the initial
 *    theme also rides in the ui/initialize response's hostContext.
 *
 * This adapter exposes the minimal interface required by the migration:
 *    callTool(name, args)        -> Promise<structuredContent>
 *    onResourceUpdate(cb)        -> subscribe to resource updates
 *    onProgress(cb)              -> subscribe to generation progress
 *    onThemeChange(cb)           -> subscribe to host theme changes (ctx.theme)
 *    connect()                   -> Promise<"mcp" | "standalone">
 *
 * If no host answers (opened outside ZCode, or during integration bring-up),
 * the bridge degrades to a local in-page demo backend so the panel stays fully
 * usable. Integration-phase verification notes live in README.md.
 */
(function (global) {
  "use strict";

  var PROTOCOL_VERSION = "2025-06-18";
  var UI_PROTOCOL_VERSION = "2026-01-26";
  var CLIENT_INFO = { name: "hba-uigen-panel", version: "0.4.0" };
  var APP_INFO = { name: "hba-uigen", version: "0.4.0" };

  // -------------------------------------------------------------------------
  // local demo backend — 原型库工具面的内存 mock(uigen_* 新契约),
  // standalone 打开 panel 时走这里;宿主 MCP 可用时不经过它。
  // -------------------------------------------------------------------------
  var WORKSPACE = "/demo/workspace";

  function demoPage(title, bodyHtml) {
    return "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"utf-8\">\n" +
      "  <meta name=\"viewport\" content=\"width=390, initial-scale=1\">\n" +
      "  <title>" + title + "</title>\n  <style>\n    * { box-sizing: border-box; margin: 0; }\n" +
      "    body { width: 390px; min-height: 844px; font-family: system-ui, sans-serif; background: #f5f6f8; color: #1f2329; }\n" +
      "    .bar { height: 56px; display: flex; align-items: center; padding: 0 16px; background: #2b6cb0; color: #fff; font-size: 17px; font-weight: 600; }\n" +
      "    main { padding: 16px; }\n    h1 { font-size: 22px; margin: 12px 0 6px; }\n" +
      "    p { font-size: 13px; color: #4b5563; line-height: 1.6; margin-bottom: 8px; }\n" +
      "    .btn { display: inline-block; margin-top: 12px; padding: 10px 18px; border: 0; cursor: pointer; border-radius: 8px; background: #2b6cb0; color: #fff; font-size: 14px; }\n" +
      "    .field { display: block; width: 100%; margin-top: 10px; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; background: #fff; }\n" +
      "  </style>\n</head>\n<body>\n  <header class=\"bar\">" + title + "</header>\n  <main>\n" +
      bodyHtml + "\n  </main>\n</body>\n</html>\n";
  }

  function blankPage(stem) {
    return demoPage(stem, "    <h1>" + stem + "</h1>\n    <p>新页面,从树的 ⋯ 菜单或画布进入编辑。</p>");
  }

  var DEMO_JSX = "// banner.jsx — 演示 JSX 产物(单页视图以代码形式展示)\n" +
    "export default function Banner() {\n  return (\n" +
    "    <div className=\"banner\">\n      <h1>促销横幅</h1>\n" +
    "      <p>限时活动进行中 — JSX 产物在单页视图里显示源码。</p>\n" +
    "    </div>\n  );\n}\n";

  function localBackend() {
    // 虚拟工作区文件系统:key = 工作区相对 posix 路径("" = 工作区根)
    var fsMap = null;
    var root = "";            // 原型根(工作区相对路径;"" = 工作区根本身,与 server 缺省对齐)
    // 布局持久化:standalone 下 mock 即"服务端",用 localStorage 模拟 canvas-layout.json
    // 落盘,刷新面板后画布布局/卡片位置才能恢复(与宿主 MCP 模式行为对齐)。
    var LAYOUT_KEY = "hba-uigen-local-canvas-layout";
    var canvasLayout = null;
    try {
      var savedLayout = global.localStorage ? global.localStorage.getItem(LAYOUT_KEY) : null;
      if (savedLayout) canvasLayout = JSON.parse(savedLayout);
    } catch (e) { canvasLayout = null; }
    // 技能假数据:字段面与 server.mjs normalizeSkillRecord 对齐
    // (id/name/description/category/scope/is_active/sort_order/instructions/examples),
    // 8 条覆盖多分类、2 条 is_active:false,供技能弹窗走查。
    var skills = [
      {
        id: "skill-landing-hero", name: "营销落地页",
        description: "单页营销落地页骨架(Hero + 卖点 + CTA)",
        category: "layout", scope: "global", is_active: true, sort_order: 10,
        instructions: "# 营销落地页\n\n- 顶部大图 Hero\n- 三列卖点卡片\n- 底部 CTA 按钮",
        examples: "", updatedAt: "2026-11-01T00:00:00.000Z"
      },
      {
        id: "skill-auth-flow", name: "登录注册流",
        description: "登录 / 注册 / 找回密码三屏流程",
        category: "components", scope: "global", is_active: true, sort_order: 20,
        instructions: "# 登录注册流\n\n- login 登录屏\n- register 注册屏\n- reset 找回密码屏",
        examples: "", updatedAt: "2026-11-01T00:00:00.000Z"
      },
      {
        id: "skill-brand-voice", name: "品牌语调",
        description: "",
        category: "brand", scope: "global", is_active: true, sort_order: 30,
        instructions: "# 品牌语调\n\n- 第二人称称呼用户\n- 禁用夸张感叹号\n- 价格统一「¥ + 数字」",
        examples: "", updatedAt: "2026-11-01T00:00:00.000Z"
      },
      {
        id: "skill-style-minimal", name: "极简风格",
        description: "留白优先、单主色、弱阴影的视觉基调",
        category: "style", scope: "global", is_active: true, sort_order: 40,
        instructions: "# 极简风格\n\n- 单主色 + 中性灰\n- 卡片圆角 8-12px\n- 阴影只用一层",
        examples: "", updatedAt: "2026-10-28T00:00:00.000Z"
      },
      {
        id: "skill-constraints-a11y", name: "无障碍约束",
        description: "对比度、焦点态与语义标签的硬性约束",
        category: "constraints", scope: "global", is_active: true, sort_order: 50,
        instructions: "# 无障碍约束\n\n- 正文对比度 ≥ 4.5:1,大字号 ≥ 3:1\n- 所有可交互元素必须有 :focus-visible 焦点态,焦点环颜色与主色一致且不得被 overflow 裁切\n- 图标按钮必须有 aria-label 或 title,纯装饰图标 aria-hidden=\"true\"\n- 页面结构按 header/main/footer/section 语义标签组织,标题层级 h1→h2→h3 不跳级\n- 表单控件必须有关联 label,错误提示用 aria-describedby 关联并 role=\"alert\"\n- 触控目标不小于 44×44px,间距不小于 8px 以防误触\n- 动画遵循 prefers-reduced-motion,开启减弱动效时仅保留不超过 100ms 的透明度过渡\n- 颜色不作为传达信息的唯一手段,状态同时给出文字或图标",
        examples: "", updatedAt: "2026-10-20T00:00:00.000Z"
      },
      {
        id: "skill-general-copy", name: "文案规范",
        description: "界面文案的长度、标点与术语口径",
        category: "general", scope: "global", is_active: true, sort_order: 60,
        instructions: "# 文案规范\n\n- 按钮文案 ≤ 6 字\n- 中文标点用全角,数字/英文半角\n- 术语首次出现给一句话解释",
        examples: "", updatedAt: "2026-10-15T00:00:00.000Z"
      },
      {
        id: "skill-legacy-grid", name: "旧版九宫格",
        description: "已停用的九宫格模板,默认不注入提示词",
        category: "general", scope: "global", is_active: false, sort_order: 70,
        instructions: "# 旧版九宫格\n\n- 3x3 图标宫格\n- 固定 88px 格宽",
        examples: "", updatedAt: "2026-10-01T00:00:00.000Z"
      },
      {
        id: "skill-motion-heavy", name: "重动效模板",
        description: "停用:动效过多与极简基调冲突",
        category: "style", scope: "global", is_active: false, sort_order: 80,
        instructions: "# 重动效模板\n\n- 页面转场 300ms\n- 卡片入场逐个 stagger",
        examples: "", updatedAt: "2026-09-20T00:00:00.000Z"
      }
    ];

    /** name → slug(与 server.mjs slugify 同口径):小写、非字母数字转 -、空则 untitled。 */
    function slugify(s) {
      var slug = String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
      return slug || "untitled";
    }

    function seed() {
      var m = {};
      function mod(p) { m[p] = { type: "module" }; }
      function page(p, content) { m[p] = { type: "page", content: content }; }
      mod("prototypes"); mod("assets"); mod("docs");
      page("prototypes/home.html", demoPage("首页",
        "    <h1>首页</h1>\n    <p>mock 原型的首页,用于 standalone 走查全览画布与单页视图。</p>\n    <button class=\"btn\" type=\"button\">主要按钮</button>"));
      mod("prototypes/auth");
      page("prototypes/auth/login.html", demoPage("登录",
        "    <h1>登录</h1>\n    <p>输入用户名与密码(演示表单,无脚本)。</p>\n" +
        "    <input class=\"field\" placeholder=\"用户名\" value=\"demo\">\n" +
        "    <input class=\"field\" placeholder=\"密码\" type=\"password\" value=\"****\">\n" +
        "    <span class=\"btn\">登录</span>"));
      page("prototypes/auth/register.html", demoPage("注册",
        "    <h1>注册</h1>\n    <p>创建账号(演示表单,无脚本)。</p>\n" +
        "    <input class=\"field\" placeholder=\"邮箱\" value=\"demo@example.com\">\n" +
        "    <span class=\"btn\">下一步</span>"));
      mod("prototypes/shop"); mod("prototypes/shop/catalog");
      page("prototypes/shop/catalog/list.html", demoPage("商品列表",
        "    <h1>商品列表</h1>\n    <p>目录页:列表项 1 / 2 / 3(演示)。</p>\n" +
        "    <p>· 无线耳机 — ¥299</p>\n    <p>· 机械键盘 — ¥499</p>\n    <p>· 显示器支架 — ¥199</p>"));
      page("prototypes/shop/catalog/detail.html", demoPage("商品详情",
        "    <h1>商品详情</h1>\n    <p>无线耳机 — ¥299。详情页用于验证单页视图预览。</p>\n" +
        "    <span class=\"btn\">加入购物车</span>"));
      mod("prototypes/playground");
      page("prototypes/playground/banner.jsx", DEMO_JSX);
      mod("prototypes/drafts");   // 空模块
      fsMap = m;
    }
    seed();

    function absPath(rel) { return rel ? WORKSPACE + "/" + rel : WORKSPACE; }

    /** 直接子节点(按磁盘字典序);dirRel="" 表示工作区根。 */
    function childrenOf(dirRel) {
      var prefix = dirRel ? dirRel + "/" : "";
      var out = [];
      Object.keys(fsMap).forEach(function (k) {
        if (k === dirRel || k.indexOf(prefix) !== 0) return;
        var rest = k.slice(prefix.length);
        if (rest.indexOf("/") >= 0) return;
        out.push({ name: rest, path: k, node: fsMap[k] });
      });
      out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      return out;
    }

    function extOf(name) {
      var i = name.lastIndexOf(".");
      return i > 0 ? name.slice(i + 1).toLowerCase() : "";
    }

    /** 树节点 id 相对原型根;name 页面取 stem(徽标另显扩展名)。 */
    function buildTree(dirRel, idPrefix) {
      return childrenOf(dirRel).map(function (ch) {
        var id = idPrefix ? idPrefix + "/" + ch.name : ch.name;
        if (ch.node.type === "module") {
          return { id: id, name: ch.name, type: "module", children: buildTree(ch.path, id) };
        }
        var ext = extOf(ch.name);
        var stem = ext ? ch.name.slice(0, ch.name.length - ext.length - 1) : ch.name;
        return { id: id, name: stem, type: "page", framework: ext || "html" };
      });
    }

    function countStats(dirRel) {
      var modules = 0, pages = 0;
      (function walk(d) {
        childrenOf(d).forEach(function (ch) {
          if (ch.node.type === "module") { modules += 1; walk(ch.path); } else { pages += 1; }
        });
      })(dirRel);
      return { modules: modules, pages: pages };
    }

    /** id(相对原型根) → 文件系统绝对 key。 */
    function resolveId(id) {
      id = String(id == null ? "" : id).trim().replace(/\\/g, "/").replace(/^\/+/, "");
      if (!id || id === "." || id.split("/").some(function (s) { return s === ".."; })) {
        throw new Error("非法 id: " + id);
      }
      var full = root ? root + "/" + id : id;
      if (!Object.prototype.hasOwnProperty.call(fsMap, full)) throw new Error("节点不存在: " + id);
      return full;
    }

    function isPageFull(full) {
      var name = full.slice(full.lastIndexOf("/") + 1);
      var ext = extOf(name);
      return ext === "html" || ext === "htm" || ext === "jsx" || ext === "tsx" || ext === "vue";
    }

    function moveSubtree(fromFull, toFull) {
      var keys = Object.keys(fsMap).filter(function (k) {
        return k === fromFull || k.indexOf(fromFull + "/") === 0;
      });
      keys.sort(function (a, b) { return b.length - a.length; }); // 长键先挪,避免前缀撞车
      keys.forEach(function (k) {
        var nk = toFull + k.slice(fromFull.length);
        fsMap[nk] = fsMap[k];
        delete fsMap[k];
      });
    }

    return {
      callTool: function (name, args, emitProgress) {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            try {
              args = args || {};
              if (name === "uigen_rescan" || name === "uigen_list_pages") {
                resolve({ ok: true, root: absPath(root), tree: buildTree(root, ""), stats: countStats(root) });
              } else if (name === "uigen_get_page") {
                var full = resolveId(args.id);
                if (!isPageFull(full)) return reject(new Error("不是页面: " + args.id));
                var name1 = full.slice(full.lastIndexOf("/") + 1);
                var ext1 = extOf(name1);
                resolve({
                  ok: true,
                  id: args.id,
                  name: ext1 ? name1.slice(0, name1.length - ext1.length - 1) : name1,
                  type: "page",
                  framework: ext1 || "html",
                  content: fsMap[full].content || ""
                });
              } else if (name === "uigen_save_page") {
                var id2 = String(args.id == null ? "" : args.id).trim().replace(/\\/g, "/").replace(/^\/+/, "");
                if (!id2 || id2.split("/").some(function (s) { return s === ".." || s === "."; })) {
                  return reject(new Error("非法 id: " + args.id));
                }
                var parentRel = id2.indexOf("/") < 0 ? "" : id2.slice(0, id2.lastIndexOf("/"));
                var parentFull = root ? (parentRel ? root + "/" + parentRel : root) : parentRel;
                var newName = id2.slice(id2.lastIndexOf("/") + 1);
                var existing = null;
                try { existing = resolveId(id2); } catch (e) { existing = null; }

                if (args.name !== undefined && args.name !== null && String(args.name).trim()) {
                  // 重命名:page 换 stem 保扩展名;module 换目录名
                  if (!existing) return reject(new Error("节点不存在: " + id2));
                  var target = String(args.name).trim().replace(/\\/g, "/");
                  if (!target || target.indexOf("/") >= 0 || target === "." || target === "..") {
                    return reject(new Error("非法名称: " + args.name));
                  }
                  var baseName = existing.slice(existing.lastIndexOf("/") + 1);
                  var oldExt = extOf(baseName);
                  var isPage = isPageFull(existing);
                  if (isPage) {
                    var givenExt = extOf(target);
                    if (givenExt) target = target.slice(0, target.length - givenExt.length - 1);
                    if (!target) return reject(new Error("名称不能为空"));
                    target = target + "." + (oldExt || "html");
                  }
                  var toFull = (existing.lastIndexOf("/") < 0 ? "" : existing.slice(0, existing.lastIndexOf("/") + 1)) + target;
                  if (toFull !== existing && fsMap[toFull]) return reject(new Error("已存在同名节点: " + target));
                  moveSubtree(existing, toFull);
                  var newId = (root && toFull.indexOf(root + "/") === 0)
                    ? toFull.slice(root.length + 1) : toFull;
                  resolve({ ok: true, id: newId });
                  return;
                }

                if (existing) {
                  if (args.content !== undefined && typeof args.content === "string") {
                    fsMap[existing].content = args.content;
                  }
                  resolve({ ok: true, id: id2 });
                  return;
                }
                // 新建:有页面扩展名 → 页面(默认内容);无扩展名 → 模块(mkdir)
                var ext2 = extOf(newName);
                var isPageNew = ext2 === "html" || ext2 === "htm" || ext2 === "jsx" || ext2 === "tsx" || ext2 === "vue";
                if (parentRel || root) {
                  if (!fsMap[parentFull] || fsMap[parentFull].type !== "module") {
                    return reject(new Error("父模块不存在: " + (parentRel || "/")));
                  }
                }
                if (isPageNew) {
                  var stem2 = newName.slice(0, newName.length - ext2.length - 1);
                  fsMap[root ? root + "/" + id2 : id2] = {
                    type: "page",
                    content: typeof args.content === "string" ? args.content
                      : (ext2 === "jsx" || ext2 === "tsx" ? "// " + newName + "\nexport default function Page() {\n  return null;\n}\n"
                        : ext2 === "vue" ? "<template>\n  <div>" + stem2 + "</div>\n</template>\n"
                        : blankPage(stem2))
                  };
                } else {
                  fsMap[root ? root + "/" + id2 : id2] = { type: "module" };
                }
                resolve({ ok: true, id: id2 });
              } else if (name === "uigen_delete_page") {
                var full3 = resolveId(args.id);
                var kids = Object.keys(fsMap).filter(function (k) { return k.indexOf(full3 + "/") === 0; });
                if (kids.length && !args.recursive) {
                  return reject(new Error("模块非空,需要 recursive:true"));
                }
                delete fsMap[full3];
                kids.forEach(function (k) { delete fsMap[k]; });
                resolve({ ok: true, deleted: String(args.id) });
              } else if (name === "uigen_list_skills") {
                // 与 server toolListSkills 同口径:缺省只回启用项,includeInactive 回全部
                resolve({
                  ok: true,
                  skills: skills.filter(function (s) { return args.includeInactive || s.is_active !== false; })
                    .map(function (s) {
                      return {
                        id: s.id, name: s.name, description: s.description,
                        category: s.category, scope: s.scope, is_active: s.is_active,
                        sort_order: s.sort_order, instructions: s.instructions, examples: s.examples
                      };
                    })
                });
              } else if (name === "uigen_get_skill") {
                var found = null;
                skills.forEach(function (s) { if (s.id === String(args.id)) found = s; });
                if (!found) return reject(new Error("skill not found: " + args.id));
                resolve({
                  ok: true, id: found.id, name: found.name, description: found.description,
                  category: found.category, scope: found.scope, is_active: found.is_active,
                  sort_order: found.sort_order, instructions: found.instructions, examples: found.examples
                });
              } else if (name === "uigen_save_skill") {
                // 与 server toolSaveSkill 同口径:name + instructions 每次必填,
                // 更新时未传字段保留存储值(is_active 切换只回传整条记录改开关)。
                var skillName = String(args.name || "").trim();
                var instructions = typeof args.instructions === "string" ? args.instructions : "";
                if (!skillName) return reject(new Error("name is required"));
                if (!instructions.trim()) {
                  return reject(new Error("instructions is required and must be non-empty"));
                }
                var sid = args.id ? String(args.id) : "";
                var target2 = null;
                skills.forEach(function (s) { if (s.id === sid) target2 = s; });
                if (sid && !target2) return reject(new Error("skill not found: " + sid));
                if (!target2) {
                  var base = "skill-" + slugify(skillName);
                  var newId = base, suffix = 1, used = {};
                  skills.forEach(function (s) { used[s.id] = true; });
                  while (used[newId]) { suffix += 1; newId = base + "-" + suffix; }
                  target2 = {
                    id: newId, scope: "global", category: "general", description: "",
                    is_active: true, sort_order: 0, examples: ""
                  };
                  skills.push(target2);
                }
                target2.name = skillName;
                if (typeof args.description === "string") target2.description = args.description;
                target2.instructions = instructions;
                if (typeof args.category === "string" && args.category) target2.category = args.category;
                if (typeof args.is_active === "boolean") target2.is_active = args.is_active;
                if (Number.isFinite(args.sort_order)) target2.sort_order = Math.trunc(args.sort_order);
                target2.updatedAt = new Date().toISOString();
                resolve({ ok: true, id: target2.id });
              } else if (name === "uigen_delete_skill") {
                var at = -1;
                skills.forEach(function (s, i) { if (s.id === String(args.id)) at = i; });
                if (at < 0) return reject(new Error("skill not found: " + args.id));
                var gone = skills.splice(at, 1)[0];
                resolve({ ok: true, deleted: gone.id });
              } else if (name === "uigen_canvas_save") {
                var layout = args.layoutJson;
                if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
                  return reject(new Error("layoutJson must be an object"));
                }
                canvasLayout = layout;
                try {
                  if (global.localStorage) global.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
                } catch (e) { /* 存储不可用时退回内存态 */ }
                resolve({ ok: true, updatedAt: new Date().toISOString(), bytes: 0, file: "(panel-local, 未写盘)" });
              } else if (name === "uigen_canvas_get") {
                resolve({
                  ok: true, layout: canvasLayout, updatedAt: "",
                  workspace: { name: "demo-workspace", root: WORKSPACE }
                });
              } else {
                reject(new Error("unknown tool: " + name));
              }
            } catch (e) {
              reject(e);
            }
          }, 30);
        });
      }
    };
  }

  // -------------------------------------------------------------------------
  // bridge
  // -------------------------------------------------------------------------
  function createUiGenBridge(options) {
    options = options || {};
    var mode = "unknown";
    var pending = new Map();
    var seq = 0;
    var resourceCbs = [];
    var progressCbs = [];
    var themeCbs = [];
    var backend = localBackend();
    var connected = false;

    function emitTheme(ctx) {
      if (!ctx || !ctx.theme) return;
      themeCbs.forEach(function (cb) { try { cb(ctx); } catch (e) { /* cb error */ } });
    }

    function post(msg) {
      var target = global.parent && global.parent !== global ? global.parent : null;
      if (!target) return false;
      try {
        target.postMessage(msg, "*");
        return true;
      } catch (e) {
        return false;
      }
    }

    function sendRequest(method, params, timeoutMs) {
      return new Promise(function (resolve, reject) {
        seq += 1;
        var id = seq;
        var timer = setTimeout(function () {
          pending.delete(id);
          reject(new Error("bridge timeout: " + method));
        }, timeoutMs || options.requestTimeoutMs || 15000);
        pending.set(id, {
          resolve: function (v) { clearTimeout(timer); resolve(v); },
          reject: function (e) { clearTimeout(timer); reject(e); }
        });
        if (!post({ jsonrpc: "2.0", id: id, method: method, params: params || {} })) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error("no host window"));
        }
      });
    }

    function sendNotification(method, params) {
      post({ jsonrpc: "2.0", method: method, params: params || {} });
    }

    function onMessage(ev) {
      var msg = ev && ev.data;
      if (!msg || msg.jsonrpc !== "2.0") return;
      if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
        var entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error.message || "bridge error"));
        else entry.resolve(msg.result);
        return;
      }
      if (typeof msg.method === "string") {
        if (msg.method === "notifications/progress" && msg.params) {
          progressCbs.forEach(function (cb) { try { cb(msg.params); } catch (e) { /* cb error */ } });
        } else if (
          msg.method === "notifications/resources/updated" ||
          msg.method === "notifications/resources/list_changed"
        ) {
          resourceCbs.forEach(function (cb) { try { cb(msg.params || {}); } catch (e) { /* cb error */ } });
        } else if (msg.method === "pluginUi.resourceUpdated" || (msg.params && msg.params.op === "pluginUi.resourceUpdated")) {
          resourceCbs.forEach(function (cb) { try { cb(msg.params || {}); } catch (e) { /* cb error */ } });
        } else if (msg.method === "ui/notifications/host-context-changed") {
          // params 是部分上下文增量,主题切换时可能只含 { theme }
          emitTheme(msg.params || {});
        }
      }
    }

    function extractResult(raw) {
      if (raw && raw.structuredContent !== undefined) return raw.structuredContent;
      if (raw && Array.isArray(raw.content)) {
        for (var i = 0; i < raw.content.length; i++) {
          if (raw.content[i].type === "text") {
            try { return JSON.parse(raw.content[i].text); } catch (e) { /* keep raw */ }
          }
        }
      }
      return raw;
    }

    var bridge = {
      get mode() { return mode; },
      onResourceUpdate: function (cb) { if (typeof cb === "function") resourceCbs.push(cb); },
      onProgress: function (cb) { if (typeof cb === "function") progressCbs.push(cb); },
      onThemeChange: function (cb) { if (typeof cb === "function") themeCbs.push(cb); },

      connect: function () {
        return new Promise(function (resolve) {
          if (global.parent && global.parent !== global) {
            global.addEventListener("message", onMessage);
            var timeoutMs = options.connectTimeoutMs || 10000;
            // The view<->host channel does NOT speak MCP "initialize" (the host
            // replies "Method not found"); the handshake is exactly: ui/initialize
            // request (UI protocol 2026-01-26) -> ui/notifications/initialized.
            sendRequest("ui/initialize", {
              appInfo: APP_INFO,
              appCapabilities: { tools: { listChanged: false }, availableDisplayModes: ["inline", "fullscreen"] },
              protocolVersion: UI_PROTOCOL_VERSION
            }, timeoutMs).then(function (result) {
              sendNotification("ui/notifications/initialized", {});
              connected = true;
              mode = "mcp";
              // 初始主题在 ui/initialize 响应的 hostContext 里,先分发一次
              emitTheme((result && result.hostContext) || {});
              resolve(mode);
            }).catch(function () {
              mode = "standalone";
              resolve(mode);
            });
          } else {
            mode = "standalone";
            resolve(mode);
          }
        });
      },

      callTool: function (name, args) {
        if (mode === "mcp" && connected) {
          var token = "uigen-" + (++seq);
          return sendRequest("tools/call", {
            name: name,
            arguments: args || {},
            _meta: { progressToken: token }
          }).then(extractResult);
        }
        return backend.callTool(name, args || {}, function (p) {
          progressCbs.forEach(function (cb) { try { cb(p); } catch (e) { /* cb error */ } });
        });
      },

      // low-level escape hatch (integration bring-up / diagnostics)
      request: sendRequest,
      notify: sendNotification
    };
    return bridge;
  }

  var api = { create: createUiGenBridge, version: "0.4.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.UiGenBridge = api;
})(typeof window !== "undefined" ? window : globalThis);
