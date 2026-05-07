已使用 align-contracts 判断 API 契约由 `priceInCents` 拥有语义，并修改了 [src/ProductPrice.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-07/skill-1/src/ProductPrice.tsx)：组件继续接收 `priceInCents`，但显示前除以 `100`，避免把“分”误当成美元主单位。

未运行测试：该最小 fixture 的 `package.json` 没有提供测试或 typecheck 脚本。