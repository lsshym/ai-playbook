已按 `align-contracts` 处理语义不匹配。

改动文件：
- [src/CheckoutBadge.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-04/skill-1/src/CheckoutBadge.tsx:7)

具体改动：
- 不再把 API 的 `status` 当作 UI 的 `CheckoutType` 返回。
- `toCheckoutType` 现在返回 `CheckoutType | undefined`，显式表达 API 当前缺少 checkout type。
- 加了 FIXME 注释说明：`status` 是支付状态，不是 checkout type。

验证：已用 `rg` 确认相关引用只在该文件内。`git diff` 无法使用，因为这个 fixture 不是 git 仓库。