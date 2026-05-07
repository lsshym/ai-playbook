已按 align-contracts 处理完成。

修改了 [src/UserCard.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-05/skill-2/src/UserCard.tsx)：把 `UserCard` 的 `avatarUrl` 改为可选，并在缺失头像时渲染名称作为显式空状态；`UserCardFromApi` 不再读取 API 没有提供的 `user.avatarUrl`，也没有伪造占位字段。

验证：fixture 的 `package.json` 没有 scripts，无法运行项目 typecheck。