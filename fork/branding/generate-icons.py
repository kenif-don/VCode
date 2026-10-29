#!/usr/bin/env python3
"""HBA 白标图标生成(fork/branding/generate-icons.py)

从 fork/branding/icons/hba-icon-1024.png(HBA 品牌图)生成整套产品图标并铺到
zcode 源码树的既有位置(尺寸/命名与上游保持一致,fork/README §4-2):

  packages/desktop/build/icons/{16..1024}.png     Linux 图标组
  packages/desktop/build/icon.png                 1024(源图,剥元数据)
  packages/desktop/build/icon_installer.png       同上(NSIS 安装器)
  packages/desktop/build/icon_windows.png         同上(Windows 资源副本)
  packages/desktop/build/icon.ico                 多档 ICO(16/24/32/48/64/128/256)
  packages/desktop/build/icon_installer.ico       同上(与 icon.ico 字节一致)
  packages/desktop/build/icon.icns                ICNS(16..1024)
  packages/desktop/build/icon_installer.icns      同上
  public/logo/icons/{16..1024}.png + icon.ico + icon.icns
  public/icon_512@2x.png                          1024(更新弹窗 dock 图标)
  packages/web/public/favicon.ico                 与 build/icon.ico 字节一致
  packages/ui/src/assets/brand-icon.png           256(应用内 logo 资产)
  packages/web/index.html                         favicon 内嵌 data URI 重生成

一致性约束(packages/web/test/webRemoteControlBootstrapShell.test.ts):
  web/public/favicon.ico == desktop/build/icon.ico == public/logo/icons/icon.ico,
  web/index.html 的 favicon data URI == public/logo/icons/32x32.png 内容。
  本脚本统一从同一源图生成并互相拷贝,天然满足。

用法: python generate-icons.py <zcode-src-root>
依赖: Pillow(仅生成期;应用期零依赖)。幂等。
"""

import base64
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

SRC_ICON = Path(__file__).parent / "icons" / "hba-icon-1024.png"
ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def png_bytes(im: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def ico_bytes(im: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    im.convert("RGBA").save(buf, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    return buf.getvalue()


def icns_bytes(im: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    im.convert("RGBA").save(buf, format="ICNS")
    return buf.getvalue()


def write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return
    path.write_bytes(data)
    print(f"  wrote {path}")


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python generate-icons.py <zcode-src-root>")
        sys.exit(2)
    root = Path(sys.argv[1])
    im = Image.open(SRC_ICON).convert("RGBA")
    assert im.size == (1024, 1024), f"source icon must be 1024x1024, got {im.size}"

    # 各档 PNG
    size_pngs = {}
    for s in ICON_SIZES:
        size_pngs[s] = png_bytes(im.resize((s, s), Image.LANCZOS))

    build = root / "packages" / "desktop" / "build"
    public_logo = root / "public" / "logo" / "icons"

    for s in ICON_SIZES:
        write(build / "icons" / f"{s}x{s}.png", size_pngs[s])
        write(public_logo / f"{s}x{s}.png", size_pngs[s])

    # 1024 档三个用途同源
    icon_1024 = size_pngs[1024]
    write(build / "icon.png", icon_1024)
    write(build / "icon_installer.png", icon_1024)
    write(build / "icon_windows.png", icon_1024)
    write(root / "public" / "icon_512@2x.png", icon_1024)

    # ICO / ICNS:多个命名位点字节一致(测试要求)
    ico = ico_bytes(im)
    icns = icns_bytes(im)
    write(build / "icon.ico", ico)
    write(build / "icon_installer.ico", ico)
    write(root / "packages" / "web" / "public" / "favicon.ico", ico)
    write(public_logo / "icon.ico", ico)
    write(build / "icon.icns", icns)
    write(build / "icon_installer.icns", icns)
    write(public_logo / "icon.icns", icns)

    # 应用内 logo 资产(React 导入 + renderer 启动壳)
    write(root / "packages" / "ui" / "src" / "assets" / "brand-icon.png", size_pngs[256])
    write(root / "packages" / "desktop" / "src" / "renderer" / "brand-icon.png", size_pngs[256])

    # web/index.html favicon 内嵌 data URI ← 32x32.png(bootstrap 测试要求两者一致)
    index_path = root / "packages" / "web" / "index.html"
    html = index_path.read_text(encoding="utf-8")
    data_uri = "data:image/png;base64," + base64.b64encode(size_pngs[32]).decode("ascii")
    new_html, count = re.subn(
        r'(rel="icon"\s+type="image/png"\s+href=")data:image/png;base64,[^"]+(")',
        lambda m: m.group(1) + data_uri + m.group(2),
        html,
    )
    if count != 1:
        # 回退:href 属性与 rel/type 顺序无关时按属性定位
        new_html, count = re.subn(
            r'(<link\s[^>]*href=")data:image/png;base64,[^"]+("[^>]*sizes="32x32")',
            lambda m: m.group(1) + data_uri + m.group(2),
            html,
        )
    if count != 1:
        raise SystemExit(f"failed to locate favicon data URI in {index_path} (count={count})")
    if new_html != html:
        # 保持原文件行尾(不走 write_text 的系统行尾翻译),避免 CRLF 污染。
        index_path.write_bytes(new_html.encode("utf-8"))
        print(f"  rewrote favicon data URI in {index_path}")

    print("icon generation done")


if __name__ == "__main__":
    main()
