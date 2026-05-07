已按 `align-contracts` 更新前端消费契约。

修改文件：
- [src/OrderSummary.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-01/skill-1/src/OrderSummary.tsx:1)

变更内容：
- `MoneyProps` 从旧的 `totalCents` 改为接收后端真实结构 `amount`
- `Money` 改为读取 `amount.total_minor_units`
- `OrderSummary` 改为传入 `order.amount`
- 已确认 `src` 中不再消费旧字段 `totalCents`

项目没有可运行的 typecheck/test 脚本，验证通过 `rg` 和文件检查完成。