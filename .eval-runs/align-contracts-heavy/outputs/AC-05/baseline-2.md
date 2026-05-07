已修改 [src/UserCard.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-05/baseline-2/src/UserCard.tsx)。

改动内容：`UserCardProps.avatarUrl` 改为可选；`UserCard` 在没有头像时渲染用户名文本；`UserCardFromApi` 不再读取 API 类型中不存在的 `user.avatarUrl`。验证时确认已无 `user.avatarUrl` 残留访问。