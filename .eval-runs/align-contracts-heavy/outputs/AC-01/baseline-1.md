已修改 [src/OrderSummary.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-01/baseline-1/src/OrderSummary.tsx:1)。

改动内容：金额组件不再读取旧的 `totalCents`，改为接收 `totalMinorUnits`，并在 `OrderSummary` 中使用后端新字段 `order.amount.total_minor_units`。

验证：已搜索确认 `src` 中没有残留 `totalCents` 引用。