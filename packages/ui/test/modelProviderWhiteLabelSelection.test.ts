// @vitest-environment jsdom
import { useState } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import { useModelProviderNavigation } from "@/settings/model-provider-section/useModelProviderNavigation.js";
import {
  createCustomProviderNodeKey,
  createPresetProviderNodeKey,
} from "@/settings/model-provider-section/utils.js";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import type { PresetProviderSpec } from "@/settings/model-provider-section/constants.js";

// 白标：侧栏只展示自定义供应商。选中校正必须与该可见性收敛到同一目标，
// 否则回退 effect 会把选中写回隐藏的预置 key，与可见性校正互抢
// selectedNodeKey 形成无限重渲染（React #185，打包后点开模型配置即崩）。
const isWhiteLabelNavItemVisible = (item: { type: string }) => item.type === "custom";

function createCustomProvider(providerId: string): ProviderSettingsFormProvider {
  return {
    providerId,
    providerName: providerId,
    templateId: undefined,
    enabled: true,
    executable: true,
    hasPersonalConfig: true,
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "key" },
      api: { type: "anthropic-messages", baseUrl: "https://example.com" },
      builtinModelIds: [],
    },
    personalConfig: {},
  } as unknown as ProviderSettingsFormProvider;
}

const presetProviders: Array<PresetProviderSpec & { provider: ProviderSettingsFormProvider | null }> =
  [
    {
      id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      displayName: "Z.ai",
      provider: null,
    },
  ];

function renderSelectionHarness({
  initialSelectedNodeKey = null,
  modelProviders = [],
}: {
  initialSelectedNodeKey?: string | null;
  modelProviders?: ProviderSettingsFormProvider[];
} = {}) {
  const setSelectedNodeKey = vi.fn();
  const harness = renderHook(
    ({ selectedNodeKey }: { selectedNodeKey: string | null }) => {
      const [innerSelectedNodeKey, innerSetSelectedNodeKey] = useState(selectedNodeKey);
      useModelProviderNavigation({
        presetProviders,
        modelProviders,
        selectedNodeKey: innerSelectedNodeKey,
        setSelectedNodeKey: (key) => {
          setSelectedNodeKey(key);
          innerSetSelectedNodeKey(key);
        },
        intl: { formatMessage: ({ id }: { id: string }) => id } as never,
        isNavItemVisible: isWhiteLabelNavItemVisible,
      });
      return innerSelectedNodeKey;
    },
    { initialProps: { selectedNodeKey: initialSelectedNodeKey } },
  );
  return { ...harness, setSelectedNodeKey };
}

describe("白标模型配置选中项收敛", () => {
  it("无自定义供应商时选中稳定为空，不回落到隐藏的预置 key", () => {
    const { result, setSelectedNodeKey, rerender } = renderSelectionHarness();

    expect(result.current).toBeNull();
    for (const [key] of setSelectedNodeKey.mock.calls) {
      expect(key).not.toBe(createPresetProviderNodeKey(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan));
    }
    // 反复渲染不改写选中项：互抢效应下这里会持续震荡直至 #185。
    const settledCalls = setSelectedNodeKey.mock.calls.length;
    rerender({ selectedNodeKey: null });
    rerender({ selectedNodeKey: null });
    expect(result.current).toBeNull();
    expect(setSelectedNodeKey.mock.calls.length).toBe(settledCalls);
  });

  it("未选中时默认落在第一个自定义供应商上", () => {
    const { result, rerender } = renderSelectionHarness({
      modelProviders: [createCustomProvider("official-api"), createCustomProvider("another-api")],
    });

    expect(result.current).toBe(createCustomProviderNodeKey("official-api"));
    rerender({ selectedNodeKey: result.current });
    expect(result.current).toBe(createCustomProviderNodeKey("official-api"));
  });

  it("落在隐藏预置入口上的选中被校正到自定义供应商", () => {
    const { result, rerender } = renderSelectionHarness({
      initialSelectedNodeKey: createPresetProviderNodeKey(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan),
      modelProviders: [createCustomProvider("official-api")],
    });

    expect(result.current).toBe(createCustomProviderNodeKey("official-api"));
    rerender({ selectedNodeKey: result.current });
    expect(result.current).toBe(createCustomProviderNodeKey("official-api"));
  });

  it("落在隐藏预置入口上的选中在无自定义供应商时校正为空", () => {
    const { result, rerender } = renderSelectionHarness({
      initialSelectedNodeKey: createPresetProviderNodeKey(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan),
    });

    expect(result.current).toBeNull();
    rerender({ selectedNodeKey: result.current });
    expect(result.current).toBeNull();
  });

  it("校正只写可见 key：回退永不携带隐藏节点", () => {
    const { setSelectedNodeKey } = renderSelectionHarness({
      initialSelectedNodeKey: createPresetProviderNodeKey(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan),
      modelProviders: [createCustomProvider("official-api")],
    });

    expect(setSelectedNodeKey).toHaveBeenCalled();
    for (const [key] of setSelectedNodeKey.mock.calls) {
      expect(key === null || key.startsWith("custom:")).toBe(true);
    }
  });
});
