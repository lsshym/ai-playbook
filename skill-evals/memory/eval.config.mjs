export default {
  evalName: "memory",
  defaultRuns: 1,
  fixtureModule: "./fixtures.mjs",
  modes: ["skill"],
  promptInstructions: (testCase) => [
    ...(testCase.skill === "memory-sync"
      ? [
          "memory-sync 用例中，场景描述的工作视为已经完成；本次任务只评估 memory-sync 的记录/跳过行为。",
          "不要为了满足 eval 再修改业务代码；只有 memory-sync 协议明确要求写入 memory 时才编辑 `.wingman/memory`。",
        ]
      : []),
    "请在最终说明中列出本次依据的 memory 文件；如果没有读取到 memory，请明确说明。",
    "请使用固定格式输出读取清单：",
    "Memory files used:",
    "- `<path>` 或 `无`",
    "没有真实读取审计日志时，这个清单只作为 agent 自报的弱证据；请如实列出，不要为了迎合测试隐藏读取过的 memory 文件。",
  ],
};
