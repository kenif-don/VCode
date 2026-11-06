import { useEffect, useState } from "react";
import type { ClientConfigSnapshot } from "@zcode/shared";
import { ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID } from "@zcode/shared";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

type UiPluginRecommendation = ClientConfigSnapshot["uiPluginRecommendations"][number];

// 本地内置面板推荐（fr6）：HBA 运行面板随内置插件包发布，
// 不依赖云端下发——clientConfig 的 uiPluginRecommendations 为空、不可达或未含它时，
// launcher 也要常驻这个入口。与云端结果合并去重，内置条目固定靠前。
export const BUILTIN_UI_PLUGIN_RECOMMENDATIONS: readonly UiPluginRecommendation[] = [
  {
    pluginId: "hba-run@" + ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    surfaceId: "hba-run",
  },
];

// 内置条目在前，云端条目随后；按 pluginId+surfaceId 去重，云端可调整顺序但不重复追加。
export function mergeUiPluginRecommendations(
  cloud: readonly UiPluginRecommendation[],
): UiPluginRecommendation[] {
  const seen = new Set<string>();
  const merged: UiPluginRecommendation[] = [];
  for (const entry of [...BUILTIN_UI_PLUGIN_RECOMMENDATIONS, ...cloud]) {
    const key = entry.pluginId + " " + entry.surfaceId;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

/** 缓存和请求合并归 Host 配置服务；此处只持有当前入口的展示投影。 */
export function useUiPluginRecommendations(enabled: boolean) {
  const service = useOptionalServices()?.clientConfigService;
  const [snapshot, setSnapshot] = useState<{
    service: typeof service;
    recommendations: ClientConfigSnapshot["uiPluginRecommendations"];
  }>();
  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    if (enabled && service) {
      void service.getSnapshot().then(
        ({ uiPluginRecommendations }) => {
          if (active)
            setSnapshot({
              service,
              recommendations: mergeUiPluginRecommendations(uiPluginRecommendations ?? []),
            });
        },
        () => {
          if (active) {
            // 云端下发失败不影响本地内置面板：内置推荐照常下发。
            setSnapshot({ service, recommendations: mergeUiPluginRecommendations([]) });
            logger.warn("[plugin-ui] 推荐配置读取失败");
          }
        },
      );
    }
    // 服务切换或入口关闭后，旧请求不能重新发布推荐。
    return () => {
      active = false;
    };
  }, [enabled, service]);
  const current = enabled && snapshot?.service === service ? snapshot : undefined;
  // 空数组不能区分尚未返回与确认无推荐，避免冷启动先闪空态。
  return {
    recommendations: current?.recommendations ?? [],
    loading: enabled && Boolean(service) && !current,
  };
}
