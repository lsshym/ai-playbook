已修改 [src/OrderSummary.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-01/baseline-2/src/OrderSummary.tsx)。

变更内容：`Money` 组件不再接收旧的 `totalCents`，改为接收 `totalMinorUnits`；`OrderSummary` 现在从 `order.amount.total_minor_units` 读取后端新字段并传入金额组件。

验证：已用 `rg` 确认 `src` 中不再引用旧字段 `totalCents`。