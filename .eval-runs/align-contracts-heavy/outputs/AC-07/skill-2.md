已使用 `align-contracts` 处理这个 API 到 React 组件的 contract mismatch。

修改了 [src/ProductPrice.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-07/skill-2/src/ProductPrice.tsx:6)：保留 API 提供的 `priceInCents` 字段语义，在展示前除以 `100`，避免把“分”误当成“美元/元”主单位格式化。

验证情况：`package.json` 没有可运行 scripts；该 fixture 也不是 git 仓库，所以没有执行项目级测试或 git diff。