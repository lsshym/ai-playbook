已按 `align-contracts` 处理缺失字段契约。

修改了 [src/UserCard.tsx](/private/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-05/skill-1/src/UserCard.tsx:1)：`avatarUrl` 改为可选，组件在没有头像时渲染用户名文本；`UserCardFromApi` 不再读取 API 未提供的 `user.avatarUrl`。

验证：检查了源码引用，已没有从 `ApiUser` 读取不存在头像字段。项目没有可运行的 typecheck/test 脚本。