已按 `align-contracts` 处理完成。

修改了 [src/OrderSummary.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-01/skill-2/src/OrderSummary.tsx)：`Money` 组件改为接收当前 API 的 `amount` 契约，并从 `amount.total_minor_units` 计算显示金额；`OrderSummary` 不再读取旧的 `order.totalCents`。

验证：用 `rg` 确认 `src` 中旧字段消费已移除。项目没有 test/typecheck 脚本；`git diff` 无法运行，因为该 fixture 不是 git 仓库。