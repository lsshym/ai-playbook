已按 `align-contracts` 处理语义不匹配。

修改了 [src/CheckoutBadge.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-04/skill-2/src/CheckoutBadge.tsx:1)：不再把 API 的 `status` 填进 UI 的 `CheckoutType`，改为显式暴露 `CheckoutStatus` 和 `toCheckoutStatus`，避免把支付状态误当作结账类型。

验证：检查了 `CheckoutType` / `toCheckoutType` / `checkoutType` 残留引用，已无匹配。