已按 `align-contracts` 处理契约错位，只改了 [src/ProfilePanel.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-17/skill-2/src/ProfilePanel.tsx)。

变更：组件现在从 API 契约字段 `display_name` 读取，并在局部别名为 `displayName` 后渲染。没有改 CSS 或其他无关视觉代码。

验证：该 fixture 没有 typecheck/test 脚本；已检查目标文件内容。