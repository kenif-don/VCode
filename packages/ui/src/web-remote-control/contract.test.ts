import { describe, expect, it } from "vitest";

import { deviceNavigation } from "@/web-remote-control/contract.example.js";
import { webRemoteControlUiModule } from "@/web-remote-control/module.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
describe("web-remote-control-ui contract", () => {
  it("declares its module manifest", () => {
    expect(webRemoteControlUiModule.id).toBe("web-remote-control-ui");
  });

  it("shapes device navigation from the remote switcher contract", () => {
    const chooseOtherDevice = () => {};
    const navigation = deviceNavigation(chooseOtherDevice);
    expect(navigation.deviceName).toBe("Example computer");
    expect(navigation.chooseOtherDevice).toBe(chooseOtherDevice);
  });
});
