已按 `align-contracts` 处理契约错位，只修改了 [src/ProfilePanel.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-17/skill-1/src/ProfilePanel.tsx)：组件现在读取 provider 类型实际提供的 `display_name`，不再读取不存在的 `displayName`。

没有修改 CSS。项目没有可用的 typecheck/test 脚本，已直接检查文件内容确认改动。